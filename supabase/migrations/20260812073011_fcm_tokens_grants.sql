-- 20260803120000_fcm_tokens.sql created the table but never granted PostgREST
-- roles access to it, unlike every sibling table in this project (established
-- in 20260731160500_grants.sql, followed by push_subscriptions/order_broadcasts/
-- ordering_pause). Without this, both the client-side FCM token upsert
-- (src/lib/fcm.ts, as `authenticated`) and the send-reminders/notify-order edge
-- functions' fcm lookup/prune (as `service_role`) fail with "permission denied
-- for table fcm_tokens" — reproduced locally while testing the 9am reminder change.

grant select, insert, update, delete on public.fcm_tokens to authenticated;
grant select, insert, update, delete on public.fcm_tokens to service_role;
