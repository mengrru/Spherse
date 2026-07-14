import { asset } from "@/lib/utils";

export interface UseCase {
  screenshot: string;
  i18nKey: string;
}

export const useCases: UseCase[] = [
  {
    screenshot: asset("screenshots/use-cases/1.png"),
    i18nKey: "usecase.1",
  },
  {
    screenshot: asset("screenshots/use-cases/2.png"),
    i18nKey: "usecase.2",
  },
  {
    screenshot: asset("screenshots/use-cases/3.png"),
    i18nKey: "usecase.3",
  },
  {
    screenshot: asset("screenshots/use-cases/4.png"),
    i18nKey: "usecase.4",
  },
];
