"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderOpen, HardDriveDownload, Loader2, Save } from "lucide-react";
import {
  hasNativeSavePicker,
  requestSaveAs,
  setSaveAsListener,
  type SaveAsRequest,
} from "@/lib/save-as";
import { useToast } from "@/hooks/use-toast";

/**
 * Диалог «Сохранить как»: спрашивает имя файла перед сохранением.
 * Монтируется один раз в layout страницы; все операции сохранения
 * и экспорта проходят через него.
 */
export function SaveAsDialog() {
  const [req, setReq] = useState<SaveAsRequest | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerAvailable, setPickerAvailable] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    setPickerAvailable(hasNativeSavePicker());
    setSaveAsListener((r) => {
      setName(r.defaultName);
      setReq(r);
    });
    return () => setSaveAsListener(null);
  }, []);

  const close = () => {
    if (busy) return;
    setReq(null);
    setBusy(false);
  };

  const handleConfirm = async () => {
    if (!req || busy) return;
    const finalName = name.trim() || req.defaultName;
    setBusy(true);
    try {
      const blob = await req.getBlob();

      // 1. Нативный диалог «куда сохранить» (Chromium, Edge и др.)
      if (hasNativeSavePicker()) {
        try {
          const handle = await (
            window as unknown as {
              showSaveFilePicker: (opts: unknown) => Promise<{
                createWritable: () => Promise<{
                  write: (d: Blob) => Promise<void>;
                  close: () => Promise<void>;
                }>;
              }>;
            }
          ).showSaveFilePicker({
            suggestedName: finalName,
            types: [
              {
                description: req.typeLabel,
                accept: req.accept,
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          toast({
            title: "Файл сохранён",
            description: finalName,
          });
          req.onSaved?.(finalName);
          setReq(null);
          return;
        } catch (e: unknown) {
          const errName = (e as { name?: string })?.name;
          if (errName === "AbortError") {
            // Пользователь отменил нативный диалог — возвращаемся к нашему окну
            setBusy(false);
            return;
          }
          // В песочнице/iframe API может быть запрещён — скачиваем с указанным именем
        }
      }

      // 2. Fallback: скачивание в «Загрузки» с выбранным именем
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast({
        title: "Файл сохранён в «Загрузки»",
        description: finalName,
      });
      req.onSaved?.(finalName);
      setReq(null);
    } catch (err) {
      console.error("Ошибка сохранения:", err);
      toast({
        variant: "destructive",
        title: "Не удалось сохранить файл",
        description: String(err instanceof Error ? err.message : err),
      });
    } finally {
      setBusy(false);
    }
  };

  const ext = req ? Object.values(req.accept)[0]?.[0] ?? "" : "";

  return (
    <Dialog open={!!req} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => { if (busy) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Save className="h-4 w-4 text-emerald-600" />
            {req?.title ?? ""}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1.5">
              <p>Укажите имя файла — перед сохранением спрашиваем, куда и как его сохранить.</p>
              {req?.scopeHint && (
                <p className="text-[11px] font-medium text-slate-500">
                  Будет экспортировано: {req.scopeHint}
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="save-as-name" className="text-xs text-slate-600">
              Имя файла
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="save-as-name"
                autoFocus
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleConfirm();
                  }
                }}
                className="h-9 text-sm"
              />
              {ext && (
                <span className="text-xs text-slate-400 font-mono shrink-0">{ext}</span>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2">
            {pickerAvailable ? (
              <>
                <FolderOpen className="h-3.5 w-3.5 mt-0.5 text-emerald-600 shrink-0" />
                <p className="text-[11px] leading-snug text-slate-500">
                  После нажатия «Сохранить» откроется системный диалог — выберите
                  папку для файла.
                </p>
              </>
            ) : (
              <>
                <HardDriveDownload className="h-3.5 w-3.5 mt-0.5 text-slate-400 shrink-0" />
                <p className="text-[11px] leading-snug text-slate-500">
                  Файл будет сохранён в папку «Загрузки» браузера с указанным именем.
                </p>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={close} disabled={busy}>
            Отмена
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={busy || !name.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Подготовка файла...
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                Сохранить
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Удобная обёртка: открыть диалог сохранения программно */
export { requestSaveAs };
