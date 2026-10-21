-- ترند — المرحلة 2: وحدة الهوية (Better Auth).
-- §6.3 المصادقة | §8.1 رمز وصول 15 دقيقة | §9.2 ضوابط الهوية | FR-ORG-03 قبول الدعوة

------------------------------------------------------------------------------
-- مخطط auth: جداول Better Auth. هوية الدخول عامة (بريد واحد = هوية واحدة)،
-- وتُربط بمستخدم ترند داخل مستأجره عبر users.auth_user_id.
-- يصل إليها دور trend_auth وحده؛ دور التطبيق لا يرى كلمات المرور ولا الأسرار.
------------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trend_auth') THEN
    CREATE ROLE trend_auth NOLOGIN NOBYPASSRLS;
  END IF;
  -- مالك دوال البحث العابرة للمستأجرين (انظر أدناه). لا يدخل ولا يتجاوز RLS،
  -- بل له سياسات قراءة صريحة على أعمدة محددة الغرض.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trend_lookup') THEN
    CREATE ROLE trend_lookup NOLOGIN NOBYPASSRLS;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL;
END $$;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO trend_auth;
-- يلزم لنقل ملكية الدوال إليه على قواعد مُدارة لا يكون فيها المالك superuser.
GRANT trend_lookup TO current_user;
GRANT USAGE ON SCHEMA app TO trend_lookup;

-- مولّدة من getMigrations في Better Auth بالإضافات المفعّلة (twoFactor، jwt، bearer)،
-- واختبار في apps/api يتحقق أنها مطابقة لما تتوقعه المكتبة.
CREATE TABLE auth."user" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "twoFactorEnabled" boolean
);

CREATE TABLE auth."session" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" uuid NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  -- §9.2: هذه الجلسة اجتازت العامل الثاني (حقل إضافي في إعداد Better Auth).
  "mfaVerified" boolean
);
CREATE INDEX "session_userId_idx" ON auth."session" ("userId");

CREATE TABLE auth."account" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" uuid NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL
);
CREATE INDEX "account_userId_idx" ON auth."account" ("userId");

CREATE TABLE auth."verification" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON auth."verification" ("identifier");

CREATE TABLE auth."twoFactor" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "secret" text NOT NULL,
  "backupCodes" text NOT NULL,
  "userId" uuid NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  "verified" boolean,
  "failedVerificationCount" integer,
  "lockedUntil" timestamptz
);
CREATE INDEX "twoFactor_secret_idx" ON auth."twoFactor" ("secret");
CREATE INDEX "twoFactor_userId_idx" ON auth."twoFactor" ("userId");

CREATE TABLE auth."jwks" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "publicKey" text NOT NULL,
  "privateKey" text NOT NULL,
  "createdAt" timestamptz NOT NULL,
  "expiresAt" timestamptz,
  "alg" text,
  "crv" text
);

-- §9.2: قفل الحساب بعد 5 محاولات دخول فاشلة.
CREATE TABLE auth.login_lockouts (
  email        text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO trend_auth;

------------------------------------------------------------------------------
-- الربط بين هوية الدخول ومستخدم ترند
------------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN auth_user_id uuid REFERENCES auth."user" ("id");
-- هوية واحدة لمستخدم واحد في كل مستأجر.
CREATE UNIQUE INDEX users_auth_user ON users (tenant_id, auth_user_id) WHERE auth_user_id IS NOT NULL;

-- يحدد مستخدم ترند ومستأجره من هوية الدخول عند إصدار رمز الوصول. يعمل قبل معرفة
-- المستأجر، لذا SECURITY DEFINER، ويعيد المعرّفات فقط لمستخدم نشط.
CREATE FUNCTION app.resolve_login(identity uuid)
RETURNS TABLE (user_id uuid, tenant_id uuid, privileged boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.tenant_id,
         EXISTS (SELECT 1 FROM memberships m
                  WHERE m.user_id = u.id AND m.role IN ('owner', 'admin') AND m.deleted_at IS NULL)
    FROM users u
   WHERE u.auth_user_id = identity AND u.status = 'active' AND u.deleted_at IS NULL
   ORDER BY u.created_at
   LIMIT 1;
$$;
ALTER FUNCTION app.resolve_login(uuid) OWNER TO trend_lookup;
REVOKE ALL ON FUNCTION app.resolve_login(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_login(uuid) TO trend_app;

------------------------------------------------------------------------------
-- الدعوات (FR-ORG-03): رمز لمرة واحدة، يُخزّن تجزئته فقط، بمدة صلاحية.
------------------------------------------------------------------------------

CREATE TABLE invitations (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  workspace_id  uuid NOT NULL,
  membership_id uuid NOT NULL,
  user_id       uuid NOT NULL,
  token_hash    bytea NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid DEFAULT app.current_user_id(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces (tenant_id, id)
);
CREATE INDEX invitations_membership ON invitations (membership_id);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE TRIGGER invitations_touch BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
-- لا تُسجَّل تجزئة الرمز في سجل التدقيق.
CREATE FUNCTION app.audit_invitation_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_events (tenant_id, workspace_id, actor_id, actor_type, source, action, entity_type, entity_id, after, ip)
  VALUES (
    NEW.tenant_id, NEW.workspace_id, app.current_user_id(),
    CASE WHEN app.current_user_id() IS NULL THEN 'system'
         ELSE coalesce(nullif(current_setting('app.actor_type', true), ''), 'user') END,
    coalesce(nullif(current_setting('app.source', true), ''), 'app'),
    'invitations.' || CASE WHEN TG_OP = 'INSERT' THEN 'created'
                           WHEN NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL THEN 'accepted'
                           ELSE 'updated' END,
    'invitations', NEW.id,
    to_jsonb(NEW) - 'token_hash',
    nullif(current_setting('app.ip', true), '')::inet
  );
  RETURN NULL;
END $$;
CREATE TRIGGER invitations_audit AFTER INSERT OR UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION app.audit_invitation_change();

GRANT SELECT, INSERT, UPDATE, DELETE ON invitations TO trend_app;

-- قبول الدعوة يسبق معرفة المستأجر: يُبحث بالتجزئة وحدها ويُعاد المستأجر لبدء معاملة معزولة.
CREATE FUNCTION app.find_invitation(hash bytea)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tenant_id FROM invitations
   WHERE token_hash = hash AND accepted_at IS NULL AND expires_at > now();
$$;
ALTER FUNCTION app.find_invitation(bytea) OWNER TO trend_lookup;
REVOKE ALL ON FUNCTION app.find_invitation(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.find_invitation(bytea) TO trend_app;

-- دوال البحث تعمل بصلاحية trend_lookup، وهذه سياساته: قراءة فقط، وللدوال أعلاه وحدها.
GRANT SELECT ON users, memberships, invitations TO trend_lookup;
CREATE POLICY lookup_read ON users FOR SELECT TO trend_lookup USING (true);
CREATE POLICY lookup_read ON memberships FOR SELECT TO trend_lookup USING (true);
CREATE POLICY lookup_read ON invitations FOR SELECT TO trend_lookup USING (true);
