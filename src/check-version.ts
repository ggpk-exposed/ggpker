import { connect } from "cloudflare:sockets";

async function read_socket(hostname: string, port: number): Promise<Uint8Array> {
  const socket = connect({ hostname, port });
  try {
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    await writer.write(new Uint8Array([1, 7]));
    const { value } = await reader.read();
    return value;
  } finally {
    await socket.close();
  }
}

export async function check_version(hostname: string, port: number): Promise<string> {
  const value = await read_socket(hostname, port);
  const len = value[34];
  if (value.length < 35 + len * 2) {
    console.error("you need to read more bytes", len, value.length);
  }
  const bytes = value.slice(35, 35 + len * 2);
  return new TextDecoder("utf-16le").decode(bytes);
}
