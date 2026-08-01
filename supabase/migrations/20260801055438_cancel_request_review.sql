create or replace function approve_cancel_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_status text;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;

  select meal_entry_id, status into v_entry_id, v_status
  from cancel_requests where id = request_id;

  if v_entry_id is null then
    raise exception 'cancel request not found';
  end if;
  if v_status <> 'PENDING' then
    raise exception 'cancel request already reviewed';
  end if;

  update meal_entries set status = 'CANCELLED' where id = v_entry_id;
  update cancel_requests
    set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
    where id = request_id;
end;
$$;

create or replace function reject_cancel_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;

  update cancel_requests
    set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now()
    where id = request_id and status = 'PENDING';

  if not found then
    raise exception 'cancel request not found or already reviewed';
  end if;
end;
$$;

grant execute on function approve_cancel_request(uuid) to authenticated;
grant execute on function reject_cancel_request(uuid) to authenticated;
