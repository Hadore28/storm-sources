import { contractTests } from "@storm-sources/host/testkit";
import foulabook from "../src/index";

contractTests(foulabook, [{ source: "foulabook", item: "ألف-ليلة-وليلة-نسخة-أصلية-نادرة-pdf", search: { query: "النبي", expect: "النبي" } }], `${import.meta.dir}/fixtures`);
