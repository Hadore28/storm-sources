import { contractTests } from "@storm-sources/host/testkit";
import ares from "../src/index";

contractTests(ares, [{ source: "ares", manga: "against-the-gods", search: { query: "against the gods", expect: "Against The Gods" }, minChapters: 500 }], `${import.meta.dir}/fixtures`);
