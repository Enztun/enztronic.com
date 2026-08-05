import type { Metadata } from "next";
import { ShieldCheck, UserPlus, Users } from "lucide-react";

import { archiveUserAction, createUserAction, updateUserAction } from "@/actions";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { TableShell } from "@/components/ui/table-shell";
import { listUsers, requireAdminSession } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Team",
};

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  // Re-checked server-side: hiding the nav link is not the access control.
  const currentUser = await requireAdminSession();
  const users = await listUsers();

  return (
    <>
      <PageHeader
        eyebrow="Access"
        title="Team"
        description="Who can sign in, what they can do, and how commission is earned."
      />

      <div className="mt-8 space-y-8">
        {users.length ? (
          <TableShell label="Team members">
            <thead className="border-b border-line bg-overlay-soft">
              <tr className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                <th scope="col" className="px-5 py-4 sm:px-6">Member</th>
                <th scope="col" className="px-5 py-4">Role</th>
                <th scope="col" className="px-5 py-4">Commission</th>
                <th scope="col" className="px-5 py-4 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((user) => {
                const updateAction = updateUserAction.bind(null, user.id);
                const removeAction = archiveUserAction.bind(null, user.id);
                const isSelf = user.id === currentUser.id;

                return (
                  <tr key={user.id} className="align-top text-sm">
                    <td className="px-5 py-4 sm:px-6">
                      <p className="font-semibold text-ink">{user.name}</p>
                      <p className="mt-0.5 text-xs text-muted">{user.email}</p>
                      {user.archivedAt ? (
                        <Badge className="mt-2">Removed</Badge>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 text-muted capitalize">{user.role}</td>
                    <td className="px-5 py-4 text-muted">
                      {user.role === "sales"
                        ? `${(user.commissionRateBps / 100).toFixed(2)}%`
                        : "—"}
                    </td>
                    <td className="px-5 py-4">
                      {user.archivedAt ? null : (
                        <div className="flex flex-col items-end gap-2">
                          <form
                            action={updateAction}
                            className="flex flex-wrap items-end justify-end gap-2"
                          >
                            <input type="hidden" name="version" value={user.version} />
                            <input type="hidden" name="email" value={user.email} />
                            <input type="hidden" name="name" value={user.name} />
                            <Field label="Role" htmlFor={`role-${user.id}`}>
                              <Select
                                id={`role-${user.id}`}
                                name="role"
                                defaultValue={user.role}
                                // Removing your own admin rights would lock you
                                // out of this page mid-session.
                                disabled={isSelf}
                              >
                                <option value="admin">Admin</option>
                                <option value="sales">Sales</option>
                              </Select>
                            </Field>
                            <Field
                              label="Commission %"
                              htmlFor={`commission-${user.id}`}
                            >
                              <Input
                                id={`commission-${user.id}`}
                                name="commission_percent"
                                inputMode="decimal"
                                defaultValue={(user.commissionRateBps / 100).toFixed(2)}
                                className="w-28"
                              />
                            </Field>
                            {isSelf ? (
                              <input type="hidden" name="role" value={user.role} />
                            ) : null}
                            <SubmitButton>Save</SubmitButton>
                          </form>
                          {isSelf ? null : (
                            <form action={removeAction}>
                              <input
                                type="hidden"
                                name="version"
                                value={user.version}
                              />
                              <SubmitButton variant="danger">Remove</SubmitButton>
                            </form>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        ) : null}

        <Card className="p-5 sm:p-7">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
              <UserPlus aria-hidden="true" className="size-[1.1rem]" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink">Add a member</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                The email must match the address they sign in with through
                Cloudflare Access, and be allowed by the Access policy.
              </p>
            </div>
          </div>

          <form action={createUserAction} className="mt-6 grid gap-5 sm:grid-cols-2">
            <Field label="Full name" htmlFor="name" required>
              <Input id="name" name="name" required maxLength={160} />
            </Field>
            <Field label="Sign-in email" htmlFor="email" required>
              <Input id="email" name="email" type="email" required maxLength={254} />
            </Field>
            <Field label="Role" htmlFor="role" required>
              <Select id="role" name="role" defaultValue="sales">
                <option value="sales">Sales</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
            <Field
              label="Commission %"
              htmlFor="commission_percent"
              hint="Applied to payments received on their clients' invoices."
            >
              <Input
                id="commission_percent"
                name="commission_percent"
                inputMode="decimal"
                defaultValue="0"
              />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton>Add member</SubmitButton>
            </div>
          </form>
        </Card>

        <Card className="p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <p className="text-sm leading-6 text-muted">
              Adding someone here does not grant them a login on its own. Their
              address must also be listed in the Cloudflare Access policy for{" "}
              <span className="text-ink">admin.enztronic.com</span> and in{" "}
              <span className="text-ink">CLOUDFLARE_ACCESS_ALLOWED_EMAILS</span>.
              Both boundaries must allow them; either one refusing keeps them
              out.
            </p>
          </div>
        </Card>

        {users.length ? null : (
          <Card className="p-5">
            <Users aria-hidden="true" className="size-5 text-muted" />
          </Card>
        )}
      </div>
    </>
  );
}
