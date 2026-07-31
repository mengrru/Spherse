import { asset } from "@/lib/utils";
import type { TranslationKey } from "../i18n";

export interface SampleCase {
  id: string;
  screenshot: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  zipFile: string;
}

export const cases: SampleCase[] = [
  {
    id: "harry-potter",
    screenshot: asset("screenshots/carousel-2.png"),
    titleKey: "cases.item1.title",
    descKey: "cases.item1.desc",
    zipFile: "spherse-example-harry-potter.zip",
  },
];
