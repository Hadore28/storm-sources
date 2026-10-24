import { contractTests } from "@storm-sources/host/testkit";
import freetv from "../src/index";

contractTests(freetv, [{ source: "freetv", item: "Rai1.it", search: { query: "rai", expect: "Rai 1" } }], `${import.meta.dir}/fixtures`);
