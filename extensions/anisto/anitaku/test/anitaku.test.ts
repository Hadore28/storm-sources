import { contractTests } from "@storm-sources/host/testkit";
import anitaku from "../src/index";

contractTests(anitaku, [{ source: "anitaku", item: "serie:265", search: { query: "naruto", expect: "Naruto" }, minChapters: 12 }], `${import.meta.dir}/fixtures`);
