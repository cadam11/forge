-- Synthetic app-metadata rows. Numbers chosen to satisfy the legacy
-- regression assertions: 11 applications (>10), 3 users, 24 entities (>20).

INSERT INTO app_meta.user (name, email) VALUES
  ('Admin User',       'admin@example.test'),
  ('Builder Bot',      'builder@example.test'),
  ('Read-Only Reader', 'reader@example.test');

INSERT INTO app_meta.application (name, description) VALUES
  ('Joinery',        'Database management workspace'),
  ('CRM',            'Customer relationship platform'),
  ('Billing',        'Invoicing and dunning'),
  ('Analytics',      'Reporting and dashboards'),
  ('Identity',       'Auth, users, permissions'),
  ('Notifications',  'Email and SMS dispatch'),
  ('Storage',        'Object and file storage'),
  ('Search',         'Full-text and semantic search'),
  ('Admin Portal',   'Internal back-office tools'),
  ('Public API',     'External-facing API gateway'),
  ('Knowledge Base', 'Help articles and runbooks');

INSERT INTO app_meta.entity (name, base_table, schema_name, application_id, owner_user_id) VALUES
  ('User',                'user',                'public', 5,  1),
  ('Account',             'account',             'public', 2,  1),
  ('Contact',             'contact',             'public', 2,  1),
  ('Lead',                'lead',                'public', 2,  2),
  ('Opportunity',         'opportunity',         'public', 2,  2),
  ('Invoice',             'invoice',             'public', 3,  1),
  ('Invoice Line Item',   'invoice_line_item',   'public', 3,  1),
  ('Payment',             'payment',             'public', 3,  2),
  ('Subscription',        'subscription',        'public', 3,  2),
  ('Report',              'report',              'public', 4,  3),
  ('Dashboard',           'dashboard',           'public', 4,  3),
  ('Saved Query',         'saved_query',         'public', 4,  3),
  ('Permission',          'permission',          'public', 5,  1),
  ('Role',                'role',                'public', 5,  1),
  ('Email Template',      'email_template',      'public', 6,  2),
  ('Notification Log',    'notification_log',    'public', 6,  2),
  ('File',                'file',                'public', 7,  1),
  ('Folder',              'folder',              'public', 7,  1),
  ('Search Index',        'search_index',        'public', 8,  3),
  ('Audit Log',           'audit_log',           'public', 9,  1),
  ('System Setting',      'system_setting',      'public', 9,  1),
  ('API Key',             'api_key',             'public', 10, 1),
  ('Rate Limit Bucket',   'rate_limit_bucket',   'public', 10, 2),
  ('Help Article',        'help_article',        'public', 11, 3);
