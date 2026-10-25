import { contractTests } from "@storm-sources/host/testkit";
import slayer from "../src/index";

contractTests(slayer, [{ source: "slayer", item: "485", search: { query: "death note", expect: "Death Note" }, minItems: 10, minChapters: 30 }], `${import.meta.dir}/fixtures`);
