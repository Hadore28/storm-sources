import { contractTests } from "@storm-sources/host/testkit";
import dilar from "../src/index";

contractTests(dilar, [{ source: "dilar", manga: "1", search: { query: "Solo Leveling", expect: "Solo Leveling" }, minChapters: 30 }], `${import.meta.dir}/fixtures`);
