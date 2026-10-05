-- Correct early double-encoded JSON without losing privacy choices or onboarding.
DO $$
DECLARE account record; corrected jsonb; original jsonb; characters text; iteration integer;
BEGIN
 FOR account IN SELECT id,settings FROM users WHERE jsonb_typeof(settings)='string' OR settings ? '0' LOOP
  corrected := account.settings;
  FOR iteration IN 1..4 LOOP
   EXIT WHEN jsonb_typeof(corrected)<>'string';
   corrected := (corrected #>> '{}')::jsonb;
  END LOOP;
  IF jsonb_typeof(corrected)<>'object' THEN RAISE EXCEPTION 'Account settings require manual repair'; END IF;
  -- A spread of a JSON string produced numbered character keys plus new settings.
  IF corrected ? '0' THEN
   SELECT string_agg(value #>> '{}','' ORDER BY key::numeric) INTO characters
    FROM jsonb_each(corrected) WHERE key ~ '^[0-9]+$';
   IF left(characters,1)='{' THEN
    original := characters::jsonb;
    IF jsonb_typeof(original)='object' THEN
     SELECT original || coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO corrected
      FROM jsonb_each(corrected) WHERE key !~ '^[0-9]+$';
    END IF;
   END IF;
  END IF;
  UPDATE users SET settings=corrected WHERE id=account.id;
 END LOOP;
END;
$$;
ALTER TABLE users ADD CONSTRAINT user_settings_object CHECK(jsonb_typeof(settings)='object');
