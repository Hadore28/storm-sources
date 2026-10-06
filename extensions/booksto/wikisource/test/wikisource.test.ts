import { contractTests } from "@storm-sources/host/testkit";
import wikisource from "../src/index";

contractTests(
  wikisource,
  [
    { source: "wikisource-ar", item: "كليلة ودمنة", search: { query: "كليلة ودمنة", expect: "كليلة" }, minItems: 5, minChapters: 10, noCover: true },
    { source: "wikisource-en", item: "The Adventures of Sherlock Holmes (1892, US)", search: { query: "sherlock holmes", expect: "Sherlock" }, minChapters: 10, noCover: true },
  ],
  `${import.meta.dir}/fixtures`,
);
