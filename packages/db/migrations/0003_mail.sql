-- ترند — المرحلة 2: البريد الصادر.
-- §6.6 البريد | §9.2 استعادة كلمة المرور | FR-ORG-03 الدعوة بالبريد

------------------------------------------------------------------------------
-- صندوق البريد الصادر. يُكتب في معاملة الحدث نفسه (الدعوة، طلب الاستعادة)، فلا تُفقد
-- رسالة إن تعطّل المزود، ولا تُرسل رسالة لحدث تراجع. عامل في الخادم يرسل ويعيد المحاولة.
--
-- في مخطط auth لأن طلب الاستعادة يسبق معرفة المستأجر. الرابط في payload يحمل رمزاً
-- صالحاً، فيُمسح payload فور الإرسال أو بعد استنفاد المحاولات.
------------------------------------------------------------------------------

CREATE TABLE auth.mail_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template     text NOT NULL CHECK (template IN ('password_reset', 'invitation')),
  to_email     text NOT NULL CHECK (char_length(to_email) <= 320),
  locale       text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar', 'en')),
  payload      jsonb NOT NULL DEFAULT '{}',
  -- رسالة أحدث بالمفتاح نفسه تلغي ما لم يُرسل بعد (مثل دعوة أعيد إصدارها فبطل رابطها).
  supersede_key text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  send_after   timestamptz NOT NULL DEFAULT now(),
  -- يحجز الصف لعامل واحد؛ إن توقف العامل أثناء الإرسال يعود الصف متاحاً بعد انقضائه.
  locked_until timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  sent_at      timestamptz
);
CREATE INDEX mail_outbox_pending ON auth.mail_outbox (send_after) WHERE sent_at IS NULL;
CREATE INDEX mail_outbox_recent ON auth.mail_outbox (to_email, template, created_at);
CREATE INDEX mail_outbox_supersede ON auth.mail_outbox (supersede_key) WHERE sent_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON auth.mail_outbox TO trend_auth;
-- دور التطبيق يضيف رسائل الدعوة داخل معاملة المستأجر، ويلغي ما بطل منها. لا يقرأ محتوى الرسائل.
GRANT USAGE ON SCHEMA auth TO trend_app;
GRANT INSERT, DELETE ON auth.mail_outbox TO trend_app;
GRANT SELECT (supersede_key, sent_at) ON auth.mail_outbox TO trend_app;

------------------------------------------------------------------------------
-- مستلم رسالة الاستعادة: اسم ولغة مستخدم نشط لهوية الدخول، وإلا لا شيء.
-- حساب موقوف أو مدعو لم يفعّل لا تصله رسالة استعادة.
------------------------------------------------------------------------------

CREATE FUNCTION app.reset_recipient(identity uuid)
RETURNS TABLE (name_ar text, name_en text, locale text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.name_ar, u.name_en, u.locale
    FROM users u
   WHERE u.auth_user_id = identity AND u.status = 'active' AND u.deleted_at IS NULL
   ORDER BY u.created_at
   LIMIT 1;
$$;
ALTER FUNCTION app.reset_recipient(uuid) OWNER TO trend_lookup;
REVOKE ALL ON FUNCTION app.reset_recipient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reset_recipient(uuid) TO trend_app;
