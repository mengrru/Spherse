import { useRef, useState } from "react";
import { MessageCircleQuestionIcon, SendIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import type { QuestionCard } from "./types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

interface QuestionCardRendererProps {
  card: QuestionCard;
  onRespondQuestion?: (requestId: string, answer: string) => boolean | void;
}

function QuestionText({ question }: { question: string }) {
  return (
    <div className="flex items-start gap-1.5 text-sm">
      <MessageCircleQuestionIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <p className="min-w-0 whitespace-pre-wrap text-foreground">{question}</p>
    </div>
  );
}

function AnsweredQuestion({ question, answer }: { question: string; answer?: string }) {
  const { t } = useI18n();
  return (
    <div className="my-2 space-y-1.5 rounded-lg border border-border px-3 py-2 text-xs">
      <QuestionText question={question} />
      <div>
        <span className="me-1.5 shrink-0 text-muted-foreground">{t("chat.questionAnswerLabel")}</span>
        <span className="whitespace-pre-wrap text-foreground">{answer}</span>
      </div>
    </div>
  );
}

function TimedOutQuestion({ question }: { question: string }) {
  const { t } = useI18n();
  return (
    <div className="my-2 space-y-1.5 rounded-lg border border-border px-3 py-2 text-xs">
      <QuestionText question={question} />
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <MessageCircleQuestionIcon className="size-3.5 shrink-0" />
        {t("chat.questionTimeoutLabel")}
      </div>
    </div>
  );
}

export function QuestionCardRenderer({ card, onRespondQuestion }: QuestionCardRendererProps) {
  const { t } = useI18n();
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const composingRef = useRef(false);

  if (card.status === "timeout") {
    return <TimedOutQuestion question={card.question} />;
  }
  if (card.status === "answered") {
    return <AnsweredQuestion question={card.question} answer={card.answer} />;
  }

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || submitted || !card.requestId) return;
    const delivered = onRespondQuestion?.(card.requestId, trimmed);
    if (delivered === false) return;
    setSubmitted(true);
  };

  return (
    <div className="my-2 rounded-lg border border-border bg-card px-3 py-2">
      <QuestionText question={card.question} />
      {card.options && card.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.options.map((option, index) => (
            <Button
              key={`${index}:${option}`}
              size="sm"
              variant="outline"
              disabled={submitted}
              onClick={() => submit(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <Input
          value={answer}
          maxLength={2000}
          placeholder={t("chat.questionInputPlaceholder")}
          disabled={submitted}
          onChange={(event) => setAnswer(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && !composingRef.current) {
              event.preventDefault();
              submit(answer);
            }
          }}
        />
        <Button size="sm" className="shrink-0" disabled={!answer.trim() || submitted} onClick={() => submit(answer)}>
          <SendIcon className="size-3.5" />
          {t("chat.questionSend")}
        </Button>
      </div>
    </div>
  );
}
