import { expect, type APIRequestContext } from '@playwright/test';

export async function invitationConfirmationLink(request: APIRequestContext, email: string) {
  const response = await request.get(`/api/test/invitation-mail?email=${encodeURIComponent(email)}`);
  expect(response.ok()).toBe(true);
  const mail = await response.json();
  return new URL(mail.link);
}
