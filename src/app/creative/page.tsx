import CreativeEditor from "@/components/creative/creative-editor";
import { CreativeWebMcpRegistrar } from "@/webmcp/creative/CreativeWebMcpRegistrar";

export const metadata = {
  title: "Creative Desk · Batch Relay",
  description: "Compose a reviewable sports event creative kit with Batch Relay.",
};

export default function CreativePage() {
  return <><CreativeEditor /><CreativeWebMcpRegistrar /></>;
}
