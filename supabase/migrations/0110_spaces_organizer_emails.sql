-- Recipients for new space request alerts (mirrors gear_settings.organizer_emails).
insert into spaces_settings (key, value)
values ('organizer_emails', '["info@movementinfrastructureproject.org"]'::jsonb)
on conflict (key) do nothing;
