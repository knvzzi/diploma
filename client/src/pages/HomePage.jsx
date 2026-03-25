import { Link } from 'react-router-dom';
import { MapPin, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Главная страница приложения — лендинг/дашборд.
 *
 * Содержит:
 *  - Hero-секцию с кратким описанием и CTA-кнопкой (Call To Action)
 *  - Блок с тремя карточками-фичами
 *
 * В будущем здесь появится:
 *  - Лента публичных маршрутов (с фото, рейтингом, типом активности)
 *  - Поиск и фильтрация маршрутов
 *  - Секция «Мои маршруты» для авторизованных пользователей
 */
export default function HomePage() {
  return (
    <div className="flex flex-col">

      {/* ─────────── HERO ─────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-background px-4 py-20 sm:py-28">

        {/* Декоративные круги на фоне */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 right-0 h-96 w-96 rounded-full bg-primary/5 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-10 h-64 w-64 rounded-full bg-primary/8 blur-2xl"
        />

        <div className="relative mx-auto max-w-3xl text-center">
          {/* Иконка */}
          <div className="mb-6 inline-flex items-center justify-center rounded-2xl bg-primary/10 p-4">
            <MapPin className="h-10 w-10 text-primary" />
          </div>

          <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Планируй маршруты{' '}
            <span className="text-primary">легко</span>
          </h1>

          <p className="mb-8 text-lg text-muted-foreground sm:text-xl">
            Интерактивный планировщик туристических маршрутов. Прокладывай
            пешие, велосипедные и автомобильные маршруты с расчётом высот,
            дистанции и времени в пути.
          </p>

          {/* CTA-кнопки */}
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" asChild className="gap-2">
              <Link to="/create">
                <Plus className="h-5 w-5" />
                Создать маршрут
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/search">Смотреть маршруты</Link>
            </Button>
          </div>
        </div>
      </section>

    </div>
  );
}
