import { createClient } from '@supabase/supabase-js';

// Executable falsifier for the RLS isolation boundary: proves (not just documents)
// that an employee session cannot read another user's meal_entries row and cannot
// write its own profiles.role. Exits non-zero if any check fails.

const url = process.env.PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
// Only needed as a fallback to set a password on the pre-existing employee test
// user (created by the admin-create-employee edge function, which only sends a
// password-reset email and never sets one directly).
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!anonKey) {
  console.error('Set PUBLIC_SUPABASE_ANON_KEY env var (see `supabase status`)');
  process.exit(1);
}

const EMPLOYEE_EMAIL = 'employee1@example.com';
const EMPLOYEE_PASSWORD = 'employee1234';

async function signIn(email, password) {
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login failed for ${email}: ${error.message}`);
  return client;
}

function isLocalUrl(rawUrl) {
  const host = new URL(rawUrl).hostname;
  return host === '127.0.0.1' || host === 'localhost';
}

// employee1@example.com is created via the edge function with no password set.
// Try the known test password first; if that fails, use the service-role key
// (local dev only, enforced by isLocalUrl below, not just this comment) to set
// it, then retry — same technique used to test the edge function's 403 case in
// Task 7's verification.
async function ensureEmployeeSession() {
  try {
    return await signIn(EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
  } catch (err) {
    if (!serviceRoleKey) {
      throw new Error(
        `${EMPLOYEE_EMAIL} login failed and no SUPABASE_SERVICE_ROLE_KEY was provided to set a password. ` +
          `Original error: ${err.message}`
      );
    }
    // Refuse to reset a real user's password anywhere but local dev — a stale
    // SUPABASE_SERVICE_ROLE_KEY plus PUBLIC_SUPABASE_URL pointed at staging/prod
    // must never result in this script overwriting a real credential.
    if (!isLocalUrl(url)) {
      throw new Error(
        `refusing to reset ${EMPLOYEE_EMAIL}'s password: PUBLIC_SUPABASE_URL (${url}) is not localhost/127.0.0.1. ` +
          `This self-heal path is local-dev only.`
      );
    }
    const admin = createClient(url, serviceRoleKey);
    const { data: page, error: listError } = await admin.auth.admin.listUsers();
    if (listError) throw new Error(`could not list users to find ${EMPLOYEE_EMAIL}: ${listError.message}`);
    const employeeUser = page.users.find((u) => u.email === EMPLOYEE_EMAIL);
    if (!employeeUser) {
      throw new Error(
        `${EMPLOYEE_EMAIL} does not exist — create it via the admin-create-employee edge function first`
      );
    }
    const { error: updateError } = await admin.auth.admin.updateUserById(employeeUser.id, {
      password: EMPLOYEE_PASSWORD,
    });
    if (updateError) throw new Error(`failed to set password for ${EMPLOYEE_EMAIL}: ${updateError.message}`);
    return await signIn(EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
  }
}

async function main() {
  const failures = [];

  const admin = await signIn('admin@example.com', 'admin1234');
  const {
    data: { user: adminUser },
  } = await admin.auth.getUser();

  // Seed one meal_entries row for the admin user itself (admin has no employee-only
  // insert restriction bypass; insert policy requires user_id = auth.uid(), so admin
  // inserts its own row here as test fixture for the cross-user read check below).
  const { error: seedError } = await admin
    .from('meal_entries')
    .insert({ user_id: adminUser.id, entry_date: '2026-01-01', rate_applied: 100 });
  if (seedError && !seedError.message.includes('duplicate key')) {
    failures.push(`seed failed: ${seedError.message}`);
  }

  const { data: ownRow, error: ownRowError } = await admin
    .from('meal_entries')
    .select('*')
    .eq('user_id', adminUser.id);
  if (ownRowError || !ownRow || ownRow.length === 0) {
    failures.push('admin could not read its own seeded meal_entries row');
  } else {
    console.log('Admin can read its own meal_entries row. Confirmed.');
  }

  // --- Real cross-user checks below (the actual point of this task) ---
  const employee = await ensureEmployeeSession();
  const {
    data: { user: employeeUser },
  } = await employee.auth.getUser();

  // Check 1: employee reads admin's meal_entries row. RLS must return it empty,
  // not an error — a plain SELECT with no matching rows is normal, and a real
  // permission error here would actually indicate the GRANT is missing, not that
  // isolation is working.
  const { data: crossRows, error: crossError } = await employee
    .from('meal_entries')
    .select('*')
    .eq('user_id', adminUser.id);
  if (crossError) {
    failures.push(`unexpected error reading cross-user meal_entries (expected empty result, not error): ${crossError.message}`);
  } else if (crossRows.length !== 0) {
    failures.push(`RLS ISOLATION FAILURE: employee could read admin's meal_entries row(s): ${JSON.stringify(crossRows)}`);
  } else {
    console.log("Employee cannot read admin's meal_entries row (empty result). Confirmed.");
  }

  // Check 2: employee attempts to promote its own role to 'admin'. The RLS policy
  // (`profiles_update_admin_only`, using (is_admin())) filters the row out of the
  // UPDATE's row set for non-admins rather than raising a permission error — so the
  // real proof is that the update affects zero rows AND the role is unchanged when
  // re-read, not that the call throws. Both an explicit error and a silent no-op
  // count as "blocked"; only an actual role change counts as failure.
  const { data: updateData, error: updateError } = await employee
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', employeeUser.id)
    .select();

  const { data: afterRows, error: afterError } = await employee
    .from('profiles')
    .select('role')
    .eq('id', employeeUser.id);

  if (afterError) {
    failures.push(`could not verify employee role after update attempt: ${afterError.message}`);
  } else {
    const roleAfter = afterRows?.[0]?.role;
    if (!updateError && Array.isArray(updateData) && updateData.length > 0) {
      failures.push(`RLS ISOLATION FAILURE: employee's role update returned success with data: ${JSON.stringify(updateData)}`);
    } else if (roleAfter !== 'employee') {
      failures.push(`RLS ISOLATION FAILURE: employee's role is now '${roleAfter}', expected unchanged 'employee'`);
    } else {
      console.log(
        `Employee cannot write its own role (update affected 0 rows${updateError ? `, error: ${updateError.message}` : ''}, role remains 'employee'). Confirmed.`
      );
    }
  }

  if (failures.length > 0) {
    console.error('RLS verification FAILED:');
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }

  console.log('RLS verification passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
