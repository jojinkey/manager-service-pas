import test from "node:test";
import assert from "node:assert/strict";
import {
  employeeInput,
  requireAdmin,
} from "../supabase/functions/employee-admin/validation.mjs";
const good = {
  name: "Test Manager",
  phone: "+919876543210",
  restaurant_id: "kampai",
  role: "manager",
};
test("only verified admins can provision employees", () => {
  assert.throws(() => requireAdmin(null), /Administrator/);
  assert.throws(() => requireAdmin({ role: "manager" }), /Administrator/);
  assert.throws(() => requireAdmin({ role: "admin", active: false }), /Administrator/);
  assert.equal(requireAdmin({ id: "one", role: "admin" }), "one");
});
test("chef and staff roles are accepted", () => {
  assert.equal(employeeInput({ ...good, role: "chef" }).role, "chef");
  assert.equal(employeeInput({ ...good, role: "staff" }).role, "staff");
  assert.equal(employeeInput(good).role, "manager");
});
test("employee records are scoped and cannot grant admin access", () => {
  assert.throws(() => employeeInput({ ...good, role: "admin" }), /manager/);
  assert.throws(
    () => employeeInput({ ...good, restaurant_id: "unknown" }),
    /restaurant/,
  );
  assert.deepEqual(
    employeeInput({
      ...good,
      phone: "98765 43210",
      name: " Test Manager ",
    }),
    good,
  );
});
test("account creation rejects missing identity and weak credentials", () => {
  for (const p of [
    { ...good, name: "" },
    { ...good, phone: "broken" },
    { ...good, pin: "not-accepted" },
  ])
    assert.throws(() => employeeInput(p));
});
