/**
 * «Сохранить как» — единый механизм запроса места сохранения файла.
 *
 * Любая операция, создающая файл на выходе (Сохранить PDF, Сжать,
 * Экспорт в изображения/Word/Excel, Извлечь страницы), вызывает
 * requestSaveAs() — пользователь видит диалог с именем файла и
 * подтверждает сохранение. После подтверждения:
 *  1. Если браузер поддерживает File System Access API (showSaveFilePicker) —
 *     открывается нативный диалог выбора папки и имени.
 *  2. Иначе файл скачивается в папку «Загрузки» с указанным именем.
 *
 * Важно: getBlob() вызывается ТОЛЬКО после подтверждения пользователем,
 * поэтому тяжёлая сборка файла (рендер страниц и т.п.) не выполняется,
 * пока пользователь не выбрал, куда и как сохранить результат.
 */

export interface SaveAsRequest {
  /** Заголовок диалога, например «Сохранить PDF-документ» */
  title: string;
  /** Предложенное имя файла */
  defaultName: string;
  /** MIME → расширения для showSaveFilePicker, напр. { "application/pdf": [".pdf"] } */
  accept: Record<string, string[]>;
  /** Человекочитаемое описание типа, напр. «PDF документ» */
  typeLabel: string;
  /** Что будет сохранено (подсказка в диалоге), напр. «все страницы (12)» */
  scopeHint?: string;
  /** Ленивая сборка файла — вызывается после подтверждения */
  getBlob: () => Promise<Blob>;
  /** Вызывается после успешного сохранения */
  onSaved?: (name: string) => void;
}

type Listener = (req: SaveAsRequest) => void;

let listener: Listener | null = null;

export function requestSaveAs(req: SaveAsRequest) {
  if (listener) {
    listener(req);
  } else {
    // Fallback на случай, если диалог ещё не смонтирован:
    // собираем blob и скачиваем напрямую
    req
      .getBlob()
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = req.defaultName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        req.onSaved?.(req.defaultName);
      })
      .catch((err) => alert("Ошибка сохранения: " + String(err)));
  }
}

export function setSaveAsListener(l: Listener | null) {
  listener = l;
}

/** Поддерживается ли нативный диалог выбора места сохранения */
export function hasNativeSavePicker(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}
