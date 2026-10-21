-- ترند — المرحلة 2 (الأساس): الهوية، الهيكل، الأدوار، سجل التدقيق، صندوق الأحداث.
-- §7.1 قواعد عامة | §5.4 عزل المستأجرين بـ RLS | §9.1 الأدوار | NFR-16 سجل التدقيق

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS ltree;
-- §6.4: pgvector داخل PostgreSQL نفسه. يُفعَّل من الآن ليُختبر توفره لدى مزود الاستضافة مبكراً.
CREATE EXTENSION IF NOT EXISTS vector;

-- دور التطبيق: بلا BYPASSRLS، ولا يملك الجداول، فتنطبق عليه سياسات العزل دائماً.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trend_app') THEN
    CREATE ROLE trend_app NOLOGIN NOBYPASSRLS;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL; -- الأدوار على مستوى الخادم؛ ترحيلان متزامنان لقاعدتين قد يتسابقان على إنشائه.
END $$;

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO trend_app;
GRANT USAGE ON SCHEMA public TO trend_app;

------------------------------------------------------------------------------
-- دوال مساعدة
------------------------------------------------------------------------------

-- §7.1: UUIDv7 (مرتبة زمنياً). PostgreSQL 16 لا يوفرها أصلياً.
CREATE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
          PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6),
        52, 1),
      53, 1),
    'hex')::uuid;
$$;

-- §5.4: كل اتصال يضبط app.tenant_id قبل أي استعلام. غيابه = لا صفوف (فشل آمن).
CREATE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO trend_app;

------------------------------------------------------------------------------
-- الهوية
------------------------------------------------------------------------------

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  plan        text NOT NULL DEFAULT 'internal',
  settings    jsonb NOT NULL DEFAULT '{}',
  -- §9.3: إقامة البيانات داخل المملكة.
  data_region text NOT NULL DEFAULT 'sa',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  email          citext NOT NULL CHECK (char_length(email) <= 320),
  phone          text,
  name_ar        text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  name_en        text CHECK (char_length(name_en) <= 200),
  locale         text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar', 'en')),
  timezone       text NOT NULL DEFAULT 'Asia/Riyadh',
  -- §10.2: الأرقام العربية (٠١٢) أو الغربية (012) لكل مستخدم.
  numeral_system text NOT NULL DEFAULT 'latn' CHECK (numeral_system IN ('arab', 'latn')),
  status         text NOT NULL DEFAULT 'invited'
                 CHECK (status IN ('invited', 'active', 'suspended', 'deactivated')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid DEFAULT app.current_user_id(),
  deleted_at     timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, email)
);

------------------------------------------------------------------------------
-- الهيكل والمساحات (FR-ORG-01..05)
------------------------------------------------------------------------------

CREATE TABLE workspaces (
  id         uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenants (id),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  identity   jsonb NOT NULL DEFAULT '{}',
  -- يحوي memberPolicy (صلاحيات العضو القابلة للضبط، §9.1).
  settings   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app.current_user_id(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, id)
);

CREATE TYPE org_unit_type AS ENUM ('sector', 'department', 'section', 'team');

CREATE FUNCTION app.org_unit_level(t org_unit_type) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE t WHEN 'sector' THEN 1 WHEN 'department' THEN 2 WHEN 'section' THEN 3 ELSE 4 END;
$$;

CREATE TABLE org_units (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  workspace_id uuid NOT NULL,
  parent_id    uuid,
  type         org_unit_type NOT NULL,
  name_ar      text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  name_en      text CHECK (char_length(name_en) <= 200),
  head_user_id uuid,
  -- §9.1: شجرة بمسار ltree لقاعدة الرؤية الهرمية.
  path         ltree NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid DEFAULT app.current_user_id(),
  deleted_at   timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (workspace_id, id),
  -- المفاتيح المركبة تمنع أي ربط بين مستأجرين أو بين مساحات حتى لو أخطأ الكود.
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES org_units (tenant_id, id),
  FOREIGN KEY (workspace_id, parent_id) REFERENCES org_units (workspace_id, id),
  FOREIGN KEY (tenant_id, head_user_id) REFERENCES users (tenant_id, id),
  CHECK (parent_id IS DISTINCT FROM id)
);
CREATE INDEX org_units_path_gist ON org_units USING gist (path);
CREATE INDEX org_units_parent ON org_units (parent_id);

CREATE FUNCTION app.org_units_set_path() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p_path ltree;
  p_type org_unit_type;
  p_ws   uuid;
  label  ltree := text2ltree(replace(NEW.id::text, '-', '_'));
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := label;
    RETURN NEW;
  END IF;

  SELECT path, type, workspace_id INTO p_path, p_type, p_ws
  FROM org_units WHERE id = NEW.parent_id AND tenant_id = NEW.tenant_id;

  IF p_path IS NULL THEN
    RAISE EXCEPTION 'org_unit_parent_not_found' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF p_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'org_unit_parent_other_workspace' USING ERRCODE = 'check_violation';
  END IF;
  -- FR-ORG-01: الوحدة تقع تحت وحدة من مستوى أعلى منها فقط.
  IF app.org_unit_level(p_type) >= app.org_unit_level(NEW.type) THEN
    RAISE EXCEPTION 'org_unit_invalid_hierarchy' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND p_path <@ OLD.path THEN
    RAISE EXCEPTION 'org_unit_cycle' USING ERRCODE = 'check_violation';
  END IF;

  NEW.path := p_path || label;
  RETURN NEW;
END $$;

CREATE TRIGGER org_units_set_path
  BEFORE INSERT OR UPDATE OF parent_id, type ON org_units
  FOR EACH ROW EXECUTE FUNCTION app.org_units_set_path();

-- نقل وحدة ينقل شجرتها كاملة. تحديث مسارات الأحفاد لا يمس parent_id فلا يعيد إطلاق المشغّل.
CREATE FUNCTION app.org_units_cascade_path() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE org_units
     SET path = NEW.path || subpath(path, nlevel(OLD.path))
   WHERE path <@ OLD.path AND id <> NEW.id AND tenant_id = NEW.tenant_id;
  RETURN NULL;
END $$;

CREATE TRIGGER org_units_cascade_path
  AFTER UPDATE OF parent_id, type ON org_units
  FOR EACH ROW WHEN (OLD.path IS DISTINCT FROM NEW.path)
  EXECUTE FUNCTION app.org_units_cascade_path();

CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member', 'guest');

-- FR-ORG-02: لكل موظف قسم أصلي ومدير مباشر. FR-ADM-02: الضيف بتاريخ انتهاء إلزامي.
CREATE TABLE memberships (
  id               uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  user_id          uuid NOT NULL,
  workspace_id     uuid NOT NULL,
  role             workspace_role NOT NULL,
  org_unit_id      uuid,
  manager_id       uuid,
  guest_expires_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT app.current_user_id(),
  deleted_at       timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces (tenant_id, id),
  FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_units (tenant_id, id),
  FOREIGN KEY (tenant_id, manager_id) REFERENCES users (tenant_id, id),
  -- القسم من المساحة نفسها، والمدير عضو في المساحة نفسها.
  FOREIGN KEY (workspace_id, org_unit_id) REFERENCES org_units (workspace_id, id),
  FOREIGN KEY (workspace_id, manager_id) REFERENCES memberships (workspace_id, user_id),
  CHECK ((role = 'guest') = (guest_expires_at IS NOT NULL)),
  CHECK (manager_id IS DISTINCT FROM user_id)
);
CREATE INDEX memberships_org_unit ON memberships (org_unit_id);
CREATE INDEX memberships_manager ON memberships (manager_id);

-- رئيس الوحدة عضو في مساحتها.
ALTER TABLE org_units ADD FOREIGN KEY (workspace_id, head_user_id)
  REFERENCES memberships (workspace_id, user_id);

-- FR-ORG-02: ربط الموظف بأقسام إضافية.
CREATE TABLE membership_org_units (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  workspace_id  uuid NOT NULL,
  membership_id uuid NOT NULL,
  org_unit_id   uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid DEFAULT app.current_user_id(),
  UNIQUE (membership_id, org_unit_id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_units (tenant_id, id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, org_unit_id) REFERENCES org_units (workspace_id, id)
);

-- FR-ORG-05: أيام العمل وساعاته على مستوى الشركة (org_unit_id فارغ) أو القسم، مع دوام رمضان.
-- §10.2: بداية الأسبوع الأحد، والعطلة الجمعة والسبت قابلة للتعديل (0 = الأحد).
CREATE TABLE work_calendars (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  workspace_id  uuid NOT NULL,
  org_unit_id   uuid,
  weekdays      smallint[] NOT NULL DEFAULT '{0,1,2,3,4}'
                CHECK (weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]),
  work_start    time NOT NULL DEFAULT '08:00',
  work_end      time NOT NULL DEFAULT '16:00',
  ramadan_start time,
  ramadan_end   time,
  holidays      jsonb NOT NULL DEFAULT '[]',
  timezone      text NOT NULL DEFAULT 'Asia/Riyadh',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid DEFAULT app.current_user_id(),
  UNIQUE NULLS NOT DISTINCT (workspace_id, org_unit_id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces (tenant_id, id),
  FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_units (tenant_id, id),
  FOREIGN KEY (workspace_id, org_unit_id) REFERENCES org_units (workspace_id, id),
  CHECK (work_end > work_start),
  CHECK ((ramadan_start IS NULL) = (ramadan_end IS NULL)),
  CHECK (ramadan_end IS NULL OR ramadan_end > ramadan_start)
);

-- §9.1 قاعدة الرؤية الهرمية: المدير يرى من هم تحته في شجرة الهيكل فقط.
-- تشمل: من في الوحدات التي يرأسها وما تحتها، ومن يتبعونه مباشرةً.
CREATE FUNCTION app.subordinate_user_ids(manager uuid, ws uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  WITH headed AS (
    SELECT path FROM org_units
     WHERE head_user_id = manager AND workspace_id = ws AND deleted_at IS NULL
  ),
  units AS (
    SELECT u.id FROM org_units u JOIN headed h ON u.path <@ h.path WHERE u.deleted_at IS NULL
  )
  SELECT DISTINCT m.user_id
    FROM memberships m
   WHERE m.workspace_id = ws
     AND m.deleted_at IS NULL
     AND m.user_id <> manager
     AND (
       m.manager_id = manager
       OR m.org_unit_id IN (SELECT id FROM units)
       OR m.id IN (SELECT membership_id FROM membership_org_units WHERE org_unit_id IN (SELECT id FROM units))
     );
$$;
GRANT EXECUTE ON FUNCTION app.subordinate_user_ids(uuid, uuid) TO trend_app;

------------------------------------------------------------------------------
-- سجل التدقيق (NFR-16، §9.2): إضافة فقط، بسلسلة تجزئة لكل مستأجر.
------------------------------------------------------------------------------

CREATE TABLE audit_events (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  -- تسلسل لكل مستأجر، يُسند داخل المشغّل بعد أخذ القفل حتى يطابق ترتيب السلسلة.
  seq         bigint NOT NULL,
  -- المساحة التي وقع فيها الحدث؛ فارغة للأحداث على مستوى المستأجر (المستأجر، المستخدمون).
  workspace_id uuid,
  actor_id    uuid,
  -- user | system | api_key | mcp
  actor_type  text NOT NULL DEFAULT 'user',
  source      text NOT NULL DEFAULT 'app',
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  prev_hash   bytea,
  hash        bytea NOT NULL,
  UNIQUE (tenant_id, seq)
);
CREATE INDEX audit_events_workspace ON audit_events (tenant_id, workspace_id, seq DESC);
CREATE INDEX audit_events_entity ON audit_events (tenant_id, entity_type, entity_id);
CREATE INDEX audit_events_actor ON audit_events (tenant_id, actor_id, occurred_at DESC);

CREATE FUNCTION app.audit_event_digest(e audit_events, prev bytea) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$
  SELECT digest(
    coalesce(prev, '\x'::bytea) ||
    convert_to(jsonb_build_object(
      'tenant_id', e.tenant_id, 'workspace_id', e.workspace_id, 'id', e.id, 'actor_id', e.actor_id, 'actor_type', e.actor_type,
      'source', e.source, 'action', e.action, 'entity_type', e.entity_type, 'entity_id', e.entity_id,
      'before', e.before, 'after', e.after, 'ip', host(e.ip),
      'seq', e.seq, 'occurred_at_us', (extract(epoch FROM e.occurred_at) * 1000000)::bigint
    )::text, 'UTF8'),
    'sha256');
$$;

CREATE FUNCTION app.audit_events_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- تسلسل الكتابة لكل مستأجر حتى تبقى السلسلة خطية.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 0));
  SELECT seq + 1, hash INTO NEW.seq, NEW.prev_hash
    FROM audit_events WHERE tenant_id = NEW.tenant_id ORDER BY seq DESC LIMIT 1;
  NEW.seq := coalesce(NEW.seq, 1);
  NEW.hash := app.audit_event_digest(NEW, NEW.prev_hash);
  RETURN NEW;
END $$;

CREATE TRIGGER audit_events_chain
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION app.audit_events_chain();

CREATE FUNCTION app.audit_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events_append_only' USING ERRCODE = 'insufficient_privilege';
END $$;

-- حتى مالك الجداول لا يستطيع التعديل أو الحذف دون تعطيل المشغّل صراحةً (وهذا يُكشف بالسلسلة).
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION app.audit_events_immutable();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.audit_events_immutable();

-- يعيد أول seq انكسرت عنده السلسلة، أو NULL إن كانت سليمة.
CREATE FUNCTION app.verify_audit_chain(t uuid) RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r audit_events;
  prev bytea := NULL;
BEGIN
  FOR r IN SELECT * FROM audit_events WHERE tenant_id = t ORDER BY seq LOOP
    IF r.prev_hash IS DISTINCT FROM prev OR r.hash <> app.audit_event_digest(r, prev) THEN
      RETURN r.seq;
    END IF;
    prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION app.verify_audit_chain(uuid) TO trend_app;

-- §7.1: كل تعديل على الكيانات الأساسية يكتب صفاً في audit_events داخل المعاملة نفسها.
CREATE FUNCTION app.audit_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_row jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  new_row jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  ref     jsonb := coalesce(new_row, old_row);
  action  text;
BEGIN
  IF TG_OP = 'UPDATE' AND old_row - 'updated_at' = new_row - 'updated_at' THEN
    RETURN NULL;
  END IF;
  action := TG_TABLE_NAME || '.' || CASE
    WHEN TG_OP = 'INSERT' THEN 'created'
    WHEN TG_OP = 'DELETE' THEN 'deleted'
    WHEN old_row ? 'deleted_at' AND old_row->>'deleted_at' IS NULL AND new_row->>'deleted_at' IS NOT NULL THEN 'trashed'
    ELSE 'updated'
  END;

  INSERT INTO audit_events (tenant_id, workspace_id, actor_id, actor_type, source, action, entity_type, entity_id, before, after, ip)
  VALUES (
    coalesce((ref->>'tenant_id')::uuid, (ref->>'id')::uuid),
    CASE WHEN TG_TABLE_NAME = 'workspaces' THEN (ref->>'id')::uuid ELSE (ref->>'workspace_id')::uuid END,
    app.current_user_id(),
    CASE WHEN app.current_user_id() IS NULL THEN 'system' ELSE coalesce(nullif(current_setting('app.actor_type', true), ''), 'user') END,
    coalesce(nullif(current_setting('app.source', true), ''), 'app'),
    action,
    TG_TABLE_NAME,
    (ref->>'id')::uuid,
    old_row,
    new_row,
    nullif(current_setting('app.ip', true), '')::inet
  );
  RETURN NULL;
END $$;

------------------------------------------------------------------------------
-- صندوق الأحداث الصادر (§5.2): يُكتب داخل المعاملة نفسها، ويوزّعه العامل الخلفي.
------------------------------------------------------------------------------

CREATE TABLE outbox_events (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  topic         text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  attempts      integer NOT NULL DEFAULT 0
);
CREATE INDEX outbox_pending ON outbox_events (created_at) WHERE dispatched_at IS NULL;

------------------------------------------------------------------------------
-- المشغّلات العامة
------------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants', 'users', 'workspaces', 'org_units', 'memberships',
                           'membership_org_units', 'work_calendars']
  LOOP
    EXECUTE format('CREATE TRIGGER %1$s_touch BEFORE UPDATE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t);
    EXECUTE format('CREATE TRIGGER %1$s_audit AFTER INSERT OR UPDATE OR DELETE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION app.audit_row_change()', t);
  END LOOP;
END $$;

------------------------------------------------------------------------------
-- عزل الصفوف (§5.4، §7.3): مُفعّل ومفروض على كل جدول يحمل tenant_id.
------------------------------------------------------------------------------

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app.current_tenant_id()) WITH CHECK (id = app.current_tenant_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'workspaces', 'org_units', 'memberships', 'membership_org_units',
                           'work_calendars', 'audit_events', 'outbox_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (tenant_id = app.current_tenant_id())
                    WITH CHECK (tenant_id = app.current_tenant_id())', t);
  END LOOP;
END $$;

------------------------------------------------------------------------------
-- صلاحيات دور التطبيق (أقل صلاحية لازمة)
------------------------------------------------------------------------------

GRANT SELECT, UPDATE ON tenants TO trend_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON users, workspaces, org_units, memberships, membership_org_units, work_calendars TO trend_app;
GRANT SELECT, INSERT ON audit_events, outbox_events TO trend_app;
