import { contractTests } from "@storm-sources/host/testkit";
import witcher from "../src/index";

contractTests(witcher, [{ source: "witcher", item: "Death Note", search: { query: "death note", expect: "Death Note" }, minItems: 10, minChapters: 30 }], `${import.meta.dir}/fixtures`);
