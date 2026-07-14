"use client";

import { useEditorStore } from "@/stores/editor-store";
import { VideoImporter } from "@/components/video/VideoImporter";
import { VideoCanvas } from "@/components/video/VideoCanvas";
import { SignalDetector } from "@/components/audio/SignalDetector";
import { StopwatchDesigner } from "@/components/stopwatch/StopwatchDesigner";
import { ExportDialog } from "@/components/export/ExportDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SplitsPanel } from "@/components/splits/SplitsPanel";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { UserMenu } from "@/components/auth/UserMenu";
import { ArrowRight, ChevronRight, RotateCcw, Waves, Palette, ListOrdered } from "lucide-react";
import { SwimHubTimerIcon } from "@/components/icons/SwimHubTimerIcon";
import { SwimHubFamilyFooter } from "@/components/layout/SwimHubFamilyFooter";
import { useTranslation } from "react-i18next";
import type { EditorStep } from "@swimhub-timer/shared";

function StepIndicator({ currentStep }: { currentStep: EditorStep }) {
  const { t } = useTranslation();
  const steps = [
    { key: "import" as const, label: t("import.stepImport"), num: 1 },
    { key: "detect" as const, label: t("import.stepDetect"), num: 2 },
    { key: "export" as const, label: t("import.stepExport"), num: 3 },
  ];
  return (
    <div className="hidden sm:flex items-center gap-1 text-[11px] font-medium">
      {steps.map((s, i) => {
        const isActive = s.key === currentStep;
        return (
          <span key={s.key} className="flex items-center">
            {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground/50 mx-0.5" />}
            <span
              className={`px-2.5 py-1 rounded-md ${
                isActive
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-surface-raised text-muted-foreground"
              }`}
            >
              {s.num}. {s.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default function Home() {
  const { t } = useTranslation();
  const { step, startTime, clearVideo, setStep } = useEditorStore();

  // Step 1: Import
  if (step === "import") {
    return (
      <AuthGuard>
        <div className="min-h-dvh flex flex-col">
          <header className="h-14 shrink-0 border-b border-border bg-surface/80 backdrop-blur-xl px-2 sm:px-4 lg:px-8 flex items-center justify-between relative z-50">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <SwimHubTimerIcon className="w-10 h-10 text-primary" />
                <span className="text-lg font-bold tracking-tight font-(family-name:--font-chakra-petch)">SwimHub Timer</span>
              </div>
              <StepIndicator currentStep="import" />
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 flex items-center justify-center p-4">
            <VideoImporter />
          </main>
          <SwimHubFamilyFooter />
        </div>
      </AuthGuard>
    );
  }

  // Step 3: Export
  if (step === "export") {
    return (
      <AuthGuard>
        <div className="min-h-dvh flex flex-col">
          <header className="h-14 shrink-0 border-b border-border bg-surface/80 backdrop-blur-xl px-2 sm:px-4 lg:px-8 flex items-center justify-between relative z-50">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <SwimHubTimerIcon className="w-10 h-10 text-primary" />
                <span className="text-lg font-bold tracking-tight font-(family-name:--font-chakra-petch)">SwimHub Timer</span>
              </div>
              <StepIndicator currentStep="export" />
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <UserMenu />
              <Button
                variant="ghost"
                size="sm"
                onClick={clearVideo}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                {t("common.new")}
              </Button>
            </div>
          </header>
          <main className="flex-1 flex items-center justify-center p-4">
            <ExportDialog />
          </main>
          <SwimHubFamilyFooter />
        </div>
      </AuthGuard>
    );
  }

  // Step 2: Detect & Design (main editor)
  return (
    <AuthGuard>
      <main className="h-dvh flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 shrink-0 border-b border-border bg-surface/80 backdrop-blur-xl px-2 sm:px-4 lg:px-8 flex items-center justify-between relative z-50">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <SwimHubTimerIcon className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm tracking-tight font-(family-name:--font-chakra-petch)">SwimHub Timer</span>
            </div>
            <StepIndicator currentStep="detect" />
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <UserMenu />
            <Button
              variant="ghost"
              size="sm"
              onClick={clearVideo}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              {t("common.new")}
            </Button>
            <Button
              size="sm"
              disabled={startTime === null}
              onClick={() => setStep("export")}
              className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan-sm"
            >
              {t("common.export")}
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </div>
        </header>

        {/* Main content */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
          {/* Left: Video preview */}
          <div className="lg:flex-1 p-3 lg:p-5 flex flex-col gap-3 min-h-0 overflow-hidden">
            <VideoCanvas />
          </div>

          {/* Right: Controls sidebar */}
          <div className="lg:w-80 xl:w-[360px] border-t lg:border-t-0 lg:border-l border-border bg-surface/50 overflow-y-auto">
            {/* Mobile: tabs */}
            <div className="lg:hidden">
              <Tabs defaultValue="signal" className="w-full">
                <TabsList className="w-full grid grid-cols-3 bg-surface-raised m-3 mb-0">
                  <TabsTrigger value="signal" className="text-xs gap-1.5">
                    <Waves className="w-3.5 h-3.5" />
                    {t("editor.tabSignal")}
                  </TabsTrigger>
                  <TabsTrigger value="design" className="text-xs gap-1.5">
                    <Palette className="w-3.5 h-3.5" />
                    {t("editor.tabDesign")}
                  </TabsTrigger>
                  <TabsTrigger value="splits" className="text-xs gap-1.5">
                    <ListOrdered className="w-3.5 h-3.5" />
                    {t("editor.tabSplits")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="signal" className="p-4">
                  <SignalDetector />
                </TabsContent>
                <TabsContent value="design" className="p-4">
                  <StopwatchDesigner />
                </TabsContent>
                <TabsContent value="splits" className="p-4">
                  <SplitsPanel />
                </TabsContent>
              </Tabs>
            </div>

            {/* Desktop: stacked */}
            <div className="hidden lg:flex flex-col gap-0">
              <div className="p-5">
                <SignalDetector />
              </div>
              <div className="h-px bg-border mx-5" />
              <div className="p-5">
                <StopwatchDesigner />
              </div>
              <div className="h-px bg-border mx-5" />
              <div className="p-5">
                <SplitsPanel />
              </div>
            </div>
          </div>
        </div>
      </main>
    </AuthGuard>
  );
}
