"use client";

import { useCallback, useState, useRef } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useVideoFile } from "@/hooks/useVideoFile";
import { SwimHubTimerIcon } from "@/components/icons/SwimHubTimerIcon";

export function VideoImporter() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { handleFile } = useVideoFile();
  const params = useParams();
  const locale = (params.locale as string) || "ja";
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      try {
        setError(null);
        handleFile(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("import.failedToLoad"));
      }
    },
    [handleFile, t],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  return (
    <div className="flex flex-col items-center gap-10 w-full max-w-xl mx-auto px-4">
      {/* Logo + title */}
      <div className="text-center space-y-3">
        <SwimHubTimerIcon className="w-28 h-28 mx-auto" />
        <h1 className="text-3xl font-bold tracking-tight font-(family-name:--font-chakra-petch)">SwimHub Timer</h1>
        <p className="text-muted-foreground text-sm max-w-xs mx-auto leading-relaxed">
          {t("import.subtitle")}
        </p>
      </div>

      {/* Guest hint */}
      {!user && (
        <div className="text-center space-y-1">
          <p className="text-xs text-muted-foreground">
            {t("auth.guestLimitHint")}
          </p>
          <Link
            href={`/${locale}/login`}
            className="text-xs font-medium text-primary hover:underline"
          >
            {t("auth.guestRegisterHint")}
          </Link>
        </div>
      )}

      {/* Drop zone */}
      <div
        className={`
          w-full rounded-2xl p-10 sm:p-14
          flex flex-col items-center gap-5 cursor-pointer
          transition-all duration-300
          ${
            isDragging
              ? "bg-primary/5 border-primary/40 border-2 border-dashed glow-cyan"
              : "bg-surface border border-border hover:border-primary/20 hover:bg-surface-raised"
          }
        `}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
      >
        <div
          className={`
            w-14 h-14 rounded-xl flex items-center justify-center
            transition-colors duration-300
            ${isDragging ? "bg-primary/10" : "bg-surface-raised"}
          `}
        >
          <Upload
            className={`w-6 h-6 transition-colors duration-300 ${
              isDragging ? "text-primary" : "text-muted-foreground"
            }`}
          />
        </div>
        <div className="text-center space-y-1.5">
          <p className="font-medium text-sm">{t("import.dropHere")}</p>
          <p className="text-xs text-muted-foreground">{t("import.orClickToBrowse")}</p>
        </div>
        <span className="text-[11px] text-muted-foreground/60 tracking-wide uppercase">
          {t("import.supportedFormats")}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
          className="hidden"
          onChange={onFileChange}
        />
      </div>

      {error && <p className="text-sm text-destructive text-center">{error}</p>}
    </div>
  );
}
