-- دور الدخول لخادم التطبيق (للتطوير المحلي فقط). يكتسب صلاحيات trend_app بعد الترحيل،
-- ولا يملك الجداول ولا BYPASSRLS، فتنطبق عليه سياسات العزل.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trend_app') THEN
    CREATE ROLE trend_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trend_auth') THEN
    CREATE ROLE trend_auth NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
CREATE ROLE trend_api LOGIN PASSWORD 'trend_api' NOSUPERUSER NOBYPASSRLS IN ROLE trend_app;
-- Better Auth: يصل إلى مخطط auth وحده.
CREATE ROLE trend_auth_api LOGIN PASSWORD 'trend_auth_api' NOSUPERUSER NOBYPASSRLS IN ROLE trend_auth;
