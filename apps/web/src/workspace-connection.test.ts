import { afterEach, expect, it, vi } from "vitest";
import { createOpCodec, createWorkspaceSecret } from "@organify/crypto";
import { createSyncClient } from "@organify/sync";
import {
  acceptWorkspace,
  createWorkspace,
  inviteToWorkspace,
  listWorkspaces,
  type WorkspaceSession,
} from "./workspace-connection";

afterEach(() => vi.unstubAllGlobals());

it("comparte una clave de espacio entre cuentas sin enviar el secreto de invitación", async () => {
  async function account(userId: string): Promise<WorkspaceSession> {
    return {
      api: createSyncClient(
        `https://${userId}.example.com`,
        "sb_publishable_test",
      ),
      userId,
      key: await createWorkspaceSecret(),
    };
  }
  const owner = await account("owner");
  const member = await account("member");
  const requests: Record<string, unknown>[] = [];
  let created: Record<string, unknown>;
  let invitation: Record<string, unknown> | undefined;
  let membership: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit) => {
    const url = new URL(input);
    const body: Record<string, unknown> = JSON.parse(String(init.body));
    requests.push(body);
    switch (url.pathname.split("/").at(-1)) {
      case "organify_workspace_create":
        created = body;
        return new Response(null, { status: 204 });
      case "organify_workspace_list": {
        const isOwner = url.hostname.startsWith("owner.");
        return Response.json(
          isOwner || membership
            ? [
                {
                  id: created.space,
                  membership_id: isOwner
                    ? "owner-membership"
                    : "member-membership",
                  is_owner: isOwner,
                  encrypted_name: created.name_box,
                  key_box: isOwner
                    ? created.own_key_box
                    : membership?.own_key_box,
                },
              ]
            : [],
        );
      }
      case "organify_workspace_invite":
        invitation = body;
        return new Response(null, { status: 204 });
      case "organify_workspace_read_invite":
        return Response.json(
          invitation && invitation.invite_proof === body.invite_proof
            ? [
                {
                  workspace_id: invitation.space,
                  key_box: invitation.invite_box,
                },
              ]
            : [],
        );
      case "organify_workspace_accept":
        membership = body;
        invitation = undefined;
        return new Response(null, { status: 204 });
      default:
        throw new Error(url.pathname);
    }
  });

  const id = await createWorkspace(owner, "Equipo privado");
  const [ownerSpace] = await listWorkspaces(owner);
  const code = await inviteToWorkspace(owner, ownerSpace, "member@example.com");
  const [prefix, inviteId, secret] = code.split(".");
  const wrongCode = [prefix, inviteId, "00".repeat(32)].join(".");
  await expect(acceptWorkspace(member, wrongCode)).rejects.toThrow(
    "invitación",
  );
  await expect(acceptWorkspace(member, code)).resolves.toBe(id);
  await expect(acceptWorkspace(member, code)).rejects.toThrow("invitación");
  const [memberSpace] = await listWorkspaces(member);
  expect(memberSpace).toMatchObject({
    id,
    name: "Equipo privado",
    owner: false,
  });
  expect(memberSpace.key).toEqual(ownerSpace.key);
  expect(memberSpace.membershipId).not.toBe(ownerSpace.membershipId);
  expect(JSON.stringify(requests)).not.toContain(secret);
  expect(JSON.stringify(requests)).not.toContain("Equipo privado");

  const op = {
    v: 1,
    id: "op",
    deviceId: "device",
    hlc: "1:0",
    entity: "item",
    entityId: "task",
    kind: "set",
    field: "title",
    value: "Tarea compartida",
  } as const;
  const scope = "workspace:" + id;
  const ciphertext = await createOpCodec(scope, ownerSpace.key).seal(op);
  const change = { opId: op.id, deviceId: op.deviceId, ciphertext };
  await expect(
    createOpCodec(scope, memberSpace.key).open(change),
  ).resolves.toEqual(op);
  await expect(
    createOpCodec(member.userId, member.key).open(change),
  ).rejects.toThrow();
  await expect(
    createOpCodec("workspace:other", memberSpace.key).open(change),
  ).rejects.toThrow();
});
