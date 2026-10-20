export function trustedMutationHeaders(host = 'localhost:3000') {
  return { host, origin: `http://${host}` };
}
