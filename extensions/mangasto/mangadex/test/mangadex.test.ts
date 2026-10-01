import { contractTests } from "@storm-sources/host/testkit";
import mangadex from "../src/index";

contractTests(
  mangadex,
  [
    {
      source: "mangadex-en",
      manga: "77bee52c-d2d6-44ad-a33a-1734c1fe696a",
      search: { query: "the eminence in shadow", expect: "Eminence in Shadow" },
      minChapters: 50,
    },
    {
      source: "mangadex-ar",
      manga: "77bee52c-d2d6-44ad-a33a-1734c1fe696a",
      search: { query: "ون بيس", expect: "ون بيس" },
    },
  ],
  `${import.meta.dir}/fixtures`,
);
