// Angular partial-compiled libs (e.g. PlatformNavigation imported transitively
// via CommonModule) need the JIT compiler available at module-load time.
// Importing `@angular/compiler` for side effects here registers it before the
// `@Component`-decorated class below is touched.
import '@angular/compiler';
import { describe, it, expect } from 'vitest';
import { LoadingComponent } from './loading.component';

describe('LoadingComponent', () => {
  it('maps each known size to its CSS class', () => {
    const component = new LoadingComponent();

    component.size = 'small';
    expect(component.sizeClass).toBe('loading-size-small');

    component.size = 'medium';
    expect(component.sizeClass).toBe('loading-size-medium');

    component.size = 'large';
    expect(component.sizeClass).toBe('loading-size-large');
  });

  it('falls back to the medium size class for an unknown size value', () => {
    const component = new LoadingComponent();

    component.size = 'huge' as unknown as LoadingComponent['size'];
    expect(component.sizeClass).toBe('loading-size-medium');
  });

  it('maps the known animation to its CSS class', () => {
    const component = new LoadingComponent();

    component.animation = 'pulse';
    expect(component.animationClass).toBe('loading-animation-pulse');
  });

  it('falls back to the pulse animation class for an unknown animation value', () => {
    const component = new LoadingComponent();

    component.animation = 'spin' as unknown as LoadingComponent['animation'];
    expect(component.animationClass).toBe('loading-animation-pulse');
  });

  it('defaults text to empty', () => {
    const component = new LoadingComponent();
    expect(component.text).toBe('');
  });
});
