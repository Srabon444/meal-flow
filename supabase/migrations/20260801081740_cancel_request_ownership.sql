-- requested_by=auth.uid() alone doesn't stop an employee guessing another
-- employee's meal_entry_id and filing a cancel request against it. Invoker
-- rights (no security definer) means this EXISTS check is itself RLS-filtered,
-- so it fails for real even before the explicit user_id match below.
create or replace function enforce_cancel_request_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from meal_entries where id = new.meal_entry_id and user_id = new.requested_by
  ) then
    raise exception 'meal entry does not belong to the requester';
  end if;

  new.status := 'PENDING';
  new.reviewed_by := null;
  new.reviewed_at := null;
  return new;
end;
$$;
