import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import useAuthStore from '@/store/useAuthStore';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const ROUTE_REASONS = [
  'Спам/реклама',
  'Опасный маршрут',
  'Неприемлемый контент',
  'Плагиат',
];

const USER_REASONS = ['Оскорбительное имя/аватар', 'Спам-аккаунт'];

const COMMENT_REASONS = [
  'Спам/реклама',
  'Оскорбление/Нецензурная лексика',
  'Разжигание ненависти',
];

/**
 * Модальное окно отправки жалобы модераторам (маршрут, пользователь или комментарий).
 */
export default function ReportModal({ isOpen, onClose, targetType, targetId }) {
  const { user } = useAuthStore();
  /** Снимок цели при открытии: при сабмите используем его, чтобы не подмешался устаревший targetId из пропсов. */
  const submitSnapshotRef = useRef({ kind: '', id: '' });
  /** Уникальный id формы: на странице часто два ReportModal (маршрут + комментарий); одинаковый id ломал отправку. */
  const formId = useId();
  const commentFieldId = `${formId}-extra-comment`;

  /** Единый нижний регистр: совпадает с CHECK в БД (user | route | comment) */
  const targetKind = useMemo(
    () => String(targetType ?? '').trim().toLowerCase(),
    [targetType],
  );

  const reasons = useMemo(() => {
    if (targetKind === 'route') return ROUTE_REASONS;
    if (targetKind === 'user') return USER_REASONS;
    if (targetKind === 'comment') return COMMENT_REASONS;
    return ROUTE_REASONS;
  }, [targetKind]);

  const [reason, setReason] = useState(() => reasons[0]);
  /** Текст пояснения к жалобе (НЕ id комментария в БД — колонка reports.comment) */
  const [detailText, setDetailText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useLayoutEffect(() => {
    if (!isOpen || targetType == null || targetId == null || String(targetId).trim() === '') {
      return;
    }
    const k = String(targetType).trim().toLowerCase();
    const id = String(targetId).trim();
    submitSnapshotRef.current = { kind: k, id };
  }, [isOpen, targetType, targetId]);

  useEffect(() => {
    if (!isOpen) return;
    setReason(reasons[0]);
    setDetailText('');
    setIsSubmitting(false);
    setIsSuccess(false);
  }, [isOpen, targetKind, targetId, reasons]);

  useEffect(() => {
    if (!isSuccess) return;
    const t = setTimeout(() => {
      onClose();
    }, 2000);
    return () => clearTimeout(t);
  }, [isSuccess, onClose]);

  const handleOpenChange = (open) => {
    if (!open && !isSubmitting) onClose();
  };

  const handleSubmit = async (e) => {
    console.log('DEBUG: Отправляем жалобу типа:', targetType, 'с ID:', targetId);
    e.preventDefault();

    if (!user?.id) {
      toast.error('Войдите в систему, чтобы отправить жалобу');
      return;
    }

    const snap = submitSnapshotRef.current;
    const kind =
      snap.kind && ['route', 'user', 'comment'].includes(snap.kind)
        ? snap.kind
        : targetKind;
    if (kind !== 'route' && kind !== 'user' && kind !== 'comment') {
      toast.error('Некорректный тип жалобы. Закройте окно и откройте снова.');
      return;
    }

    const idForDb = (snap.id && snap.id.length > 0 ? snap.id : String(targetId ?? '').trim());
    if (!idForDb) {
      toast.error('Не удалось определить объект жалобы');
      return;
    }

    // Ровно одна FK: для комментария — только reported_comment_id = PK route_comments.id
    const payload = {
      reporter_id: user.id,
      report_type: kind,
      reported_comment_id: kind === 'comment' ? idForDb : null,
      reported_route_id: kind === 'route' ? idForDb : null,
      reported_user_id: kind === 'user' ? idForDb : null,
      reason: typeof reason === 'string' ? reason : String(reason ?? ''),
      comment: detailText?.trim() || null,
    };

    console.log('--- ОТПРАВКА ЖАЛОБЫ ДЕБАГ ---');
    console.log('Тип цели:', targetType, '→ нормализован:', kind);
    console.log('ID цели (проп):', targetId, '→ для БД:', idForDb);
    console.log('Итоговый объект для БД:', payload);

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('reports').insert(payload);

      if (error) {
        console.error('[ReportModal]', error);
        toast.error(error.message || 'Не удалось отправить жалобу');
        return;
      }
      setIsSuccess(true);
    } catch (err) {
      console.error('[ReportModal]', err);
      toast.error('Не удалось отправить жалобу');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stopBubble = (e) => {
    e.stopPropagation();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onClick={stopBubble}
        onPointerDown={stopBubble}
        onPointerDownOutside={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
      >
        <div
          className="contents"
          onClick={stopBubble}
          onPointerDown={stopBubble}
        >
        <DialogHeader>
          <DialogTitle>
            {targetKind === 'comment'
              ? 'Пожаловаться на комментарий'
              : targetKind === 'user'
                ? 'Пожаловаться на пользователя'
                : 'Пожаловаться на маршрут'}
          </DialogTitle>
        </DialogHeader>

        {isSuccess ? (
          <p
            className="py-2 text-sm text-muted-foreground"
            onClick={stopBubble}
            onPointerDown={stopBubble}
          >
            Жалоба отправлена на рассмотрение модераторам
          </p>
        ) : (
          <form
            id={formId}
            onSubmit={handleSubmit}
            className="space-y-4"
            onClick={stopBubble}
            onPointerDown={stopBubble}
          >
            <fieldset className="space-y-2">
              <legend className="sr-only">Причина жалобы</legend>
              {reasons.map((r) => (
                <label
                  key={r}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-1 py-1.5 text-sm hover:bg-muted/60"
                >
                  <input
                    type="radio"
                    name={`report-reason-${formId}`}
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>{r}</span>
                </label>
              ))}
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor={commentFieldId}>Комментарий</Label>
              <Textarea
                id={commentFieldId}
                value={detailText}
                onChange={(e) => setDetailText(e.target.value)}
                placeholder="Опишите подробнее..."
                rows={4}
                disabled={isSubmitting}
              />
            </div>
          </form>
        )}

        {!isSuccess && (
          <DialogFooter
            className="gap-2 sm:gap-0"
            onClick={stopBubble}
            onPointerDown={stopBubble}
          >
            <Button
              type="button"
              variant="outline"
              onClick={() => onClose()}
              disabled={isSubmitting}
            >
              Отмена
            </Button>
            <Button type="submit" form={formId} disabled={isSubmitting}>
              {isSubmitting ? 'Отправка…' : 'Отправить'}
            </Button>
          </DialogFooter>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
