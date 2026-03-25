import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MapPin } from 'lucide-react';

import useAuthStore from '@/store/useAuthStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

/**
 * Схема валидации формы регистрации с помощью Zod.
 * Дополнительно проверяет совпадение паролей через .refine().
 */
const registerSchema = z
  .object({
    name: z
      .string()
      .min(2, 'Имя должно содержать минимум 2 символа')
      .max(50, 'Имя не может быть длиннее 50 символов'),
    email: z
      .string()
      .min(1, 'Email обязателен')
      .email('Введите корректный email адрес'),
    password: z
      .string()
      .min(6, 'Пароль должен содержать минимум 6 символов')
      .max(72, 'Пароль не может быть длиннее 72 символов'),
    confirmPassword: z.string().min(1, 'Подтвердите пароль'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Пароли не совпадают',
    path: ['confirmPassword'],   // Ошибка привязана к полю confirmPassword
  });

/**
 * Страница регистрации нового пользователя.
 * После успешной регистрации Supabase отправляет письмо с подтверждением.
 * Пользователь информируется об этом через уведомление.
 */
export default function RegisterPage() {
  const { signUp, isLoading } = useAuthStore();
  const navigate = useNavigate();

  const form = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  /**
   * Обработчик отправки формы регистрации.
   * При успехе показывает подсказку о подтверждении email.
   */
  const onSubmit = async (values) => {
    const { error } = await signUp(values.email, values.password, values.name);

    if (error) {
      toast.error(error);
    } else {
      toast.success(
        'Регистрация успешна! Проверьте вашу почту для подтверждения аккаунта.',
        { duration: 6000 }
      );
      navigate('/login');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-8">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-1 text-center">
          {/* Логотип / иконка */}
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <MapPin className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Создать аккаунт</CardTitle>
          <CardDescription>
            Заполните форму для регистрации в планировщике маршрутов
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Поле имени */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Имя</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Иван Иванов"
                        autoComplete="name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Поле email */}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="example@mail.ru"
                        autoComplete="email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Поле пароля */}
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Пароль</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Поле подтверждения пароля */}
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Подтвердите пароль</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? 'Создание аккаунта...' : 'Зарегистрироваться'}
              </Button>
            </form>
          </Form>
        </CardContent>

        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Уже есть аккаунт?{' '}
            <Link
              to="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Войти
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
