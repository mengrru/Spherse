import { Chat, type ChatProps } from "../features/chat";

export type ChatPageProps = ChatProps;

export function ChatPage(props: ChatPageProps) {
  return <Chat {...props} />;
}
