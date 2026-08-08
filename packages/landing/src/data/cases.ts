import { asset } from "@/lib/utils";
import { sampleUrl } from "@/lib/sample";
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
  {
    id: "worldbuilding-framework",
    screenshot: sampleUrl("worldbuilding-framework.png") ?? "",
    titleKey: "cases.item2.title",
    descKey: "cases.item2.desc",
    zipFile: "worldbuilding-framework.zip",
  },
];
