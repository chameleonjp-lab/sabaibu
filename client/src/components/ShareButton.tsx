import { useEffect, useRef, useState } from "react";

export const buildShareText = (text: string, url: string) => `${text.trim()}\n${url}`;

type ShareButtonProps = {
  title: string;
  text: string;
  label: string;
  testId: string;
  className?: string;
};

const getShareUrl = () => {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.href;
};

const isShareCancelled = (error: unknown) => (
  typeof error === "object"
  && error !== null
  && "name" in error
  && error.name === "AbortError"
);

export default function ShareButton({ title, text, label, testId, className = "" }: ShareButtonProps) {
  const [status, setStatus] = useState("");
  const statusTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
  }, []);

  const showStatus = (message: string) => {
    setStatus(message);
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => setStatus(""), 1800);
  };

  const share = async () => {
    const url = getShareUrl();
    const shareText = buildShareText(text, url);
    const shareData = { title, text: shareText };

    if (typeof navigator.share === "function") {
      try {
        const canUseNativeShare = typeof navigator.canShare !== "function" || navigator.canShare(shareData);
        if (canUseNativeShare) {
          await navigator.share(shareData);
          showStatus("共有画面を開きました。");
          return;
        }
      } catch (error) {
        if (isShareCancelled(error)) return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareText);
      showStatus("シェア文をコピーしました。");
    } catch {
      showStatus("シェアできませんでした。");
    }
  };

  return (
    <div className={`share-action ${className}`.trim()}>
      <button className="share-button" data-testid={testId} type="button" onClick={() => void share()}>
        {label}
      </button>
      {status && <p className="share-status" role="status" aria-live="polite">{status}</p>}
    </div>
  );
}
