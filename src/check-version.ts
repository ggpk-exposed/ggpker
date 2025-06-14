import { connect } from "cloudflare:sockets";

export async function check_version(hostname: string , port: number ) {
  try {
    const socket = connect({ hostname, port });

    const writer = socket.writable.getWriter();
    await writer.write(new Uint8Array([1, 7]));
    await writer.close();

    const reader = socket.readable.getReader();
    const { value } = await reader.read();
    const len = value[34];
    if (value.length < 35 + len * 2) {
      console.error("you need to read more bytes", len, value.length);
    }
    const bytes = value.slice(35, 35 + len * 2);
    const url = new TextDecoder("utf-16le").decode(bytes);
    console.log("got url", url);
    await socket.close();
  } catch (error) {
    console.error("Error in scheduled task", error);
  }
}
