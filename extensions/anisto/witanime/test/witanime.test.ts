import { contractTests } from "@storm-sources/host/testkit";
import witanime from "../src/index";

contractTests(witanime, [{ source: "witanime", item: "death-note", search: { query: "death note", expect: "Death Note" }, minItems: 10, minChapters: 30 }], `${import.meta.dir}/fixtures`);
