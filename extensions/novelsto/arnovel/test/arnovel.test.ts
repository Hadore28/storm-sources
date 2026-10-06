import { contractTests } from "@storm-sources/host/testkit";
import arnovel from "../src/index";

contractTests(arnovel, [{ source: "arnovel", item: "القس-المجنون", search: { query: "القس المجنون", expect: "القس المجنون" }, minChapters: 100 }], `${import.meta.dir}/fixtures`);
