import { MongoBinary } from "mongodb-memory-server";

export default async function setup(): Promise<void> {
  // Complete the shared binary download before isolated workers can race on the same archive.
  await MongoBinary.getPath();
}
