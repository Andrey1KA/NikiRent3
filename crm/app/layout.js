import "./globals.css";

export const metadata = {
  title: "Контроль переписок — NikiRent",
  description: "Поручения без отчёта, вопросы без ответа и сообщения, на которые руководитель не ответил",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
