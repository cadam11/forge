/**
 * Chat State Service
 * Manages AI chat conversations, messages, and streaming state
 */

import { Injectable, computed, inject, signal, OnDestroy } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type {
  ChatMessage,
  ChatStreamChunk,
  Conversation,
  ToolCallResult,
  ToolDefinition,
} from '@forgedb/shared';
import { IpcService } from '../services/ipc.service';
import { ConnectionStateService } from './connection.state';
import { TabStateService } from './tab.state';
import { CapabilitiesStore } from './capabilities.state';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ChatStateService implements OnDestroy {
  private readonly ipc = inject(IpcService);
  private readonly connectionState = inject(ConnectionStateService);
  private readonly tabState = inject(TabStateService);
  private readonly capabilitiesStore = inject(CapabilitiesStore);

  // State signals
  private readonly _conversations = signal<Conversation[]>([]);
  private readonly _activeConversationId = signal<string | null>(null);
  private readonly _messages = signal<ChatMessage[]>([]);
  private readonly _streaming = signal(false);
  private readonly _streamingContent = signal('');
  private readonly _tools = signal<ToolDefinition[]>([]);
  private readonly _panelOpen = signal(false);
  private readonly _conversationsExpanded = signal(false);

  // Public readonly signals
  readonly conversations = this._conversations.asReadonly();
  readonly activeConversationId = this._activeConversationId.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly streaming = this._streaming.asReadonly();
  readonly streamingContent = this._streamingContent.asReadonly();
  readonly tools = this._tools.asReadonly();
  readonly panelOpen = this._panelOpen.asReadonly();
  readonly conversationsExpanded = this._conversationsExpanded.asReadonly();

  // Computed
  readonly activeConversation = computed(() => {
    const id = this._activeConversationId();
    return this._conversations().find(c => c.id === id) || null;
  });

  readonly hasConversations = computed(() => this._conversations().length > 0);

  // Stream listener cleanup
  private streamCleanup: (() => void) | null = null;

  constructor() {
    this.setupStreamListener();
  }

  ngOnDestroy(): void {
    this.streamCleanup?.();
  }

  private setupStreamListener(): void {
    if (!this.ipc.isAvailable) return;

    this.streamCleanup = this.ipc.onChatStreamChunk((chunk: ChatStreamChunk) => {
      if (chunk.conversationId !== this._activeConversationId()) return;

      if (chunk.delta) {
        this._streamingContent.update(c => c + chunk.delta);
      }

      if (chunk.toolCall) {
        // A tool call — either pending confirmation or running
        const toolEntry: ToolCallResult = {
          id: chunk.toolCall.id,
          toolName: chunk.toolCall.toolName,
          args: chunk.toolCall.args,
          success: false,
          pendingConfirmation: chunk.toolCall.pendingConfirmation || false,
        };
        this._messages.update(msgs => {
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant') {
            return [
              ...msgs.slice(0, -1),
              { ...last, toolCalls: [...(last.toolCalls || []), toolEntry] },
            ];
          }
          return msgs;
        });
      }

      if (chunk.toolResult) {
        // A tool call result (auto-executed or confirmed)
        this._messages.update(msgs => {
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant') {
            const toolCalls = (last.toolCalls || []).map(tc =>
              tc.id === chunk.toolResult!.id ? chunk.toolResult! : tc
            );
            // If this is a new tool result not in the list, add it
            if (!toolCalls.find(tc => tc.id === chunk.toolResult!.id)) {
              toolCalls.push(chunk.toolResult!);
            }
            return [...msgs.slice(0, -1), { ...last, toolCalls }];
          }
          return msgs;
        });
      }

      if (chunk.uiAction) {
        this.handleUiAction(chunk.uiAction);
      }

      if (chunk.done) {
        // Finalize the streaming message — always clear streaming flag
        const content = this._streamingContent();
        this._messages.update(msgs => {
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            return [
              ...msgs.slice(0, -1),
              { ...last, content: content || last.content, streaming: false },
            ];
          }
          return msgs;
        });
        this._streaming.set(false);
        this._streamingContent.set('');
      }
    });
  }

  togglePanel(): void {
    this._panelOpen.update(open => !open);
  }

  openPanel(): void {
    this._panelOpen.set(true);
  }

  closePanel(): void {
    this._panelOpen.set(false);
  }

  toggleConversations(): void {
    this._conversationsExpanded.update(v => !v);
  }

  async initialize(): Promise<void> {
    if (!this.ipc.isAvailable) return;
    try {
      const [tools, conversations] = await Promise.all([
        firstValueFrom(this.ipc.getChatTools()),
        firstValueFrom(this.ipc.listConversations()),
      ]);
      this._tools.set(tools);
      this._conversations.set(conversations);
    } catch (error) {
      console.error('Failed to initialize chat state:', error);
    }
  }

  async newConversation(): Promise<void> {
    if (!this.ipc.isAvailable) return;
    try {
      const conversation = await firstValueFrom(this.ipc.createConversation());
      this._conversations.update(convs => [conversation, ...convs]);
      this._activeConversationId.set(conversation.id);
      this._messages.set([]);
      this._streamingContent.set('');
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  }

  async selectConversation(id: string): Promise<void> {
    if (!this.ipc.isAvailable) return;
    this._activeConversationId.set(id);
    try {
      const conversation = await firstValueFrom(this.ipc.getConversation(id));
      if (conversation) {
        this._messages.set(conversation.messages);
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  }

  async deleteConversation(id: string): Promise<void> {
    if (!this.ipc.isAvailable) return;
    try {
      await firstValueFrom(this.ipc.deleteConversation(id));
      this._conversations.update(convs => convs.filter(c => c.id !== id));
      if (this._activeConversationId() === id) {
        this._activeConversationId.set(null);
        this._messages.set([]);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  }

  async sendMessage(content: string, vendorId?: string, modelApiName?: string): Promise<void> {
    if (!this.ipc.isAvailable || !content.trim()) return;

    // Ensure we have an active conversation
    let conversationId = this._activeConversationId();
    if (!conversationId) {
      await this.newConversation();
      conversationId = this._activeConversationId();
    }
    if (!conversationId) return;

    // Add user message to local state
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };
    this._messages.update(msgs => [...msgs, userMessage]);

    // Add placeholder assistant message
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      streaming: true,
      toolCalls: [],
    };
    this._messages.update(msgs => [...msgs, assistantMessage]);

    this._streaming.set(true);
    this._streamingContent.set('');

    // Update conversation title in local state
    this._conversations.update(convs =>
      convs.map(c =>
        c.id === conversationId
          ? {
              ...c,
              title: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
              updatedAt: new Date().toISOString(),
            }
          : c
      )
    );

    // Include active query editor content so the AI can see what the user is working on
    const activeTab = this.tabState.activeTab();
    const activeEditorContent =
      activeTab?.type === 'query' ? this.tabState.getTabContent(activeTab.id) : undefined;

    try {
      await firstValueFrom(
        this.ipc.sendChatMessage({
          conversationId,
          message: content.trim(),
          connectionId: this.connectionState.focusedConnectionId() || undefined,
          databaseName: this.connectionState.focusedDatabaseName() || undefined,
          databaseEngine:
            this.connectionState.profileFor(this.connectionState.focusedConnectionId())?.engine ||
            undefined,
          engineVariant: this.capabilitiesStore.variantFor(
            this.connectionState.focusedConnectionId() || undefined
          ),
          activeEditorContent: activeEditorContent || undefined,
          vendorId: vendorId || undefined,
          modelApiName: modelApiName || undefined,
        })
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      this._streaming.set(false);
      // Update the assistant message with error
      this._messages.update(msgs => {
        const last = msgs[msgs.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          return [
            ...msgs.slice(0, -1),
            { ...last, content: 'Failed to get a response. Please try again.', streaming: false },
          ];
        }
        return msgs;
      });
    }
  }

  async confirmToolCall(toolCallId: string, confirmed: boolean): Promise<void> {
    const conversationId = this._activeConversationId();
    if (!conversationId || !this.ipc.isAvailable) return;

    // Update local state to remove pending flag
    if (!confirmed) {
      this._messages.update(msgs => {
        const last = msgs[msgs.length - 1];
        if (last?.role === 'assistant') {
          const toolCalls = (last.toolCalls || []).map(tc =>
            tc.id === toolCallId
              ? { ...tc, pendingConfirmation: false, success: false, error: 'Cancelled by user' }
              : tc
          );
          return [...msgs.slice(0, -1), { ...last, toolCalls }];
        }
        return msgs;
      });
    }

    try {
      await firstValueFrom(this.ipc.confirmChatTool(conversationId, toolCallId, confirmed));
    } catch (error) {
      console.error('Failed to confirm tool call:', error);
    }
  }

  private handleUiAction(action: NonNullable<ChatStreamChunk['uiAction']>): void {
    const params = action.params || {};
    switch (action.type) {
      case 'open-query-tab': {
        const connId = this.connectionState.focusedConnectionId();
        const db =
          (params['database'] as string | undefined) || this.connectionState.focusedDatabaseName();
        if (connId && db) {
          this.tabState.openQueryTab(
            connId,
            db,
            params['sql'] as string | undefined,
            (params['autoExecute'] as boolean | undefined) ?? false
          );
        }
        break;
      }
      case 'navigate-database': {
        const focused = this.connectionState.focusedConnectionId();
        if (params['database'] && focused) {
          this.connectionState.selectDatabase(focused, params['database'] as string);
        }
        break;
      }
      case 'open-settings':
      case 'open-create-db-dialog':
      case 'open-backup-dialog':
        // These are handled by the chat panel component via an event
        this._pendingUiAction.set(action);
        break;
    }
  }

  // Exposed so the chat panel component can handle dialog-opening actions
  private readonly _pendingUiAction = signal<ChatStreamChunk['uiAction'] | null>(null);
  readonly pendingUiAction = this._pendingUiAction.asReadonly();

  consumeUiAction(): ChatStreamChunk['uiAction'] | null {
    const action = this._pendingUiAction();
    this._pendingUiAction.set(null);
    return action;
  }

  async renameConversation(id: string, title: string): Promise<void> {
    if (!this.ipc.isAvailable) return;
    this._conversations.update(convs => convs.map(c => (c.id === id ? { ...c, title } : c)));
    try {
      await firstValueFrom(this.ipc.renameConversation(id, title));
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }
  }

  cancelStream(): void {
    const conversationId = this._activeConversationId();
    if (!conversationId || !this.ipc.isAvailable) return;

    firstValueFrom(this.ipc.cancelChatStream(conversationId)).catch(() => {});
    this._streaming.set(false);
    this._streamingContent.set('');
  }
}
