import { useEffect } from "react";
import { useStore } from "../../store.js";
import { ADDITIONAL_COMMENTS_KEY } from "../../utils/notification-questions.js";
import { NotificationMarker } from "../NotificationMarker.js";
import {
  NEEDS_INPUT_ANSWER_TEXTAREA_CLASS,
  NEEDS_INPUT_CARD_CLASS,
  NEEDS_INPUT_SEND_BUTTON_CLASS,
  NeedsInputRecordingStatus,
  NeedsInputSendButton,
  NeedsInputTranscriptionFailureStatus,
} from "../NeedsInputAnswerField.js";

const PLAYGROUND_NEEDS_INPUT_RECORDING_HISTORY = [
  { time: 1, level: 0.1 },
  { time: 2, level: 0.28 },
  { time: 3, level: 0.66 },
  { time: 4, level: 0.86 },
  { time: 5, level: 0.38 },
  { time: 6, level: 0.72 },
];

export function PlaygroundNeedsInputRecordingPreview() {
  return (
    <div className={`rounded-lg p-3 ${NEEDS_INPUT_CARD_CLASS}`}>
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs font-medium text-cc-attention">
        <span className="h-2 w-2 rounded-full border border-current" />
        <span className="min-w-0 truncate">Approve the rollout?</span>
      </div>
      <div className="flex min-w-0 items-end gap-1">
        <textarea
          readOnly
          value="Continue the rollout once the on-call confirms the final smoke check."
          rows={2}
          aria-label="Answer for Approve the rollout?"
          className={NEEDS_INPUT_ANSWER_TEXTAREA_CLASS}
          style={{ maxHeight: 132 }}
        />
        <button
          type="button"
          aria-label="Stop voice answer"
          aria-pressed="true"
          data-recording="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-cc-primary bg-cc-primary text-white ring-2 ring-cc-primary/30"
          title="Stop voice answer"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 animate-pulse">
            <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1z" />
            <path d="M3.5 7a.5.5 0 0 1 .5.5V8a4 4 0 0 0 8 0v-.5a.5.5 0 0 1 1 0V8a5 5 0 0 1-4.5 4.975V14.5h2a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1h2v-1.525A5 5 0 0 1 3 8v-.5a.5.5 0 0 1 .5-.5z" />
          </svg>
        </button>
      </div>
      <NeedsInputRecordingStatus
        volumeLevel={0.74}
        volumeHistory={PLAYGROUND_NEEDS_INPUT_RECORDING_HISTORY}
        inputDeviceLabel="Otter Pods Pro 3 (Bluetooth)"
      />
      <div className="mt-2 flex justify-end">
        <button type="button" className={NEEDS_INPUT_SEND_BUTTON_CLASS}>
          Reply
        </button>
      </div>
    </div>
  );
}

export function PlaygroundNeedsInputTranscriptionFailurePreview() {
  return (
    <div className={`rounded-lg p-3 ${NEEDS_INPUT_CARD_CLASS}`}>
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs font-medium text-cc-attention">
        <span className="h-2 w-2 rounded-full border border-current" />
        <span className="min-w-0 truncate">Approve the rollout?</span>
      </div>
      <div className="flex min-w-0 items-end gap-1">
        <textarea
          readOnly
          value="Continue after the smoke check passes."
          rows={2}
          aria-label="Answer for Approve the rollout?"
          className={NEEDS_INPUT_ANSWER_TEXTAREA_CLASS}
          style={{ maxHeight: 132 }}
        />
        <button
          type="button"
          aria-label="Voice answer"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-cc-border/60 text-cc-muted"
          title="Voice answer"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1z" />
            <path d="M3.5 7a.5.5 0 0 1 .5.5V8a4 4 0 0 0 8 0v-.5a.5.5 0 0 1 1 0V8a5 5 0 0 1-4.5 4.975V14.5h2a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1h2v-1.525A5 5 0 0 1 3 8v-.5a.5.5 0 0 1 .5-.5z" />
          </svg>
        </button>
      </div>
      <NeedsInputTranscriptionFailureStatus
        message="Transcription timed out"
        onRetry={() => undefined}
        onDismiss={() => undefined}
      />
      <div className="mt-2 flex justify-end">
        <button type="button" className={NEEDS_INPUT_SEND_BUTTON_CLASS}>
          Reply
        </button>
      </div>
    </div>
  );
}

/** Reply while the answer is on its way: the button shows it is waiting and ignores more presses. */
export function PlaygroundNeedsInputReplyPendingPreview() {
  return (
    <div className={`rounded-lg p-3 ${NEEDS_INPUT_CARD_CLASS}`}>
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs font-medium text-cc-attention">
        <span className="h-2 w-2 rounded-full border border-current" />
        <span className="min-w-0 truncate">Approve the rollout?</span>
      </div>
      <textarea
        readOnly
        value="Ship it"
        rows={1}
        aria-label="Answer for Approve the rollout?"
        className={`w-full ${NEEDS_INPUT_ANSWER_TEXTAREA_CLASS}`}
      />
      <div className="mt-2 flex justify-end">
        <NeedsInputSendButton label="Reply" pending disabled={false} onClick={() => undefined} />
      </div>
    </div>
  );
}

const PENDING_COMMENTS_SESSION = "playground-pending-comments-notify";

/**
 * A question card while the user has unsent conversation comments: the real card with its
 * "Include my 2 comments" checkbox. Drafts are seeded straight into the store so nothing syncs.
 */
export function PlaygroundNeedsInputPendingCommentsPreview() {
  useEffect(() => {
    const { sessionNotifications, composerDrafts } = useStore.getState();
    const notifications = new Map(sessionNotifications);
    notifications.set(PENDING_COMMENTS_SESSION, [
      {
        id: "n-pending-comments-1",
        category: "needs-input",
        timestamp: Date.now() - 60_000,
        messageId: "playground-pending-comments-msg",
        summary: "Build the attention designs?",
        suggestedAnswers: ["Yes, build designs", "Change something"],
        done: false,
      },
    ]);
    const drafts = new Map(composerDrafts);
    drafts.set(PENDING_COMMENTS_SESSION, {
      text: "",
      images: [],
      annotations: [
        { id: "pc-1", selectedText: "Remind me later moves onto items", comment: "Keep the tab reminder too." },
        { id: "pc-2", selectedText: "One list, one order", comment: "Questions first is right." },
      ],
    });
    useStore.setState({ sessionNotifications: notifications, composerDrafts: drafts });
    return () => useStore.setState({ sessionNotifications, composerDrafts });
  }, []);

  return (
    <NotificationMarker
      category="needs-input"
      summary="Build the attention designs?"
      sessionId={PENDING_COMMENTS_SESSION}
      messageId="playground-pending-comments-msg"
      notificationId="n-pending-comments-1"
    />
  );
}

const ADDITIONAL_COMMENTS_SESSION = "playground-additional-comments-notify";

/**
 * A three-question card answered and with "Additional comments" filled in, while the user also has a pending
 * conversation comment. The drafts are seeded straight into the store so nothing syncs.
 */
export function PlaygroundNeedsInputAdditionalCommentsPreview() {
  useEffect(() => {
    const { sessionNotifications, composerDrafts, needsInputDrafts } = useStore.getState();
    const notifications = new Map(sessionNotifications);
    notifications.set(ADDITIONAL_COMMENTS_SESSION, [
      {
        id: "n-additional-comments-1",
        category: "needs-input",
        timestamp: Date.now() - 60_000,
        messageId: "playground-additional-comments-msg",
        summary: "New threads: a Threads menu",
        questions: [
          {
            prompt: "Threads menu with Active and Recent: right?",
            suggestedAnswers: ["Looks right", "Change something"],
          },
          { prompt: "How should you start a thread?", suggestedAnswers: ["Menu + Ask in new thread"] },
          {
            prompt: "Should the Scribe file a settled thread?",
            suggestedAnswers: ["Scribe files it", "No auto filing"],
          },
        ],
        done: false,
      },
    ]);
    const drafts = new Map(composerDrafts);
    drafts.set(ADDITIONAL_COMMENTS_SESSION, {
      text: "",
      images: [],
      annotations: [{ id: "ac-1", selectedText: "Recent keeps a week", comment: "A week feels short." }],
    });
    const answerDrafts = new Map(needsInputDrafts);
    answerDrafts.set(
      ADDITIONAL_COMMENTS_SESSION,
      new Map([
        [
          "n-additional-comments-1",
          {
            "q-0": "Looks right",
            "q-1": "Menu + Ask in new thread",
            "q-2": "Scribe files it",
            [ADDITIONAL_COMMENTS_KEY]: "Also show the thread count on the menu button.",
          },
        ],
      ]),
    );
    useStore.setState({ sessionNotifications: notifications, composerDrafts: drafts, needsInputDrafts: answerDrafts });
    return () => useStore.setState({ sessionNotifications, composerDrafts, needsInputDrafts });
  }, []);

  return (
    <NotificationMarker
      category="needs-input"
      summary="New threads: a Threads menu"
      sessionId={ADDITIONAL_COMMENTS_SESSION}
      messageId="playground-additional-comments-msg"
      notificationId="n-additional-comments-1"
    />
  );
}
