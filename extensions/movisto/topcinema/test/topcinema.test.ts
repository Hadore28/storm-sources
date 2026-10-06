import { contractTests } from "@storm-sources/host/testkit";
import topcinema from "../src/index";

contractTests(topcinema, [{ source: "topcinema", item: "series/مسلسل-reasonable-doubt-مترجم", search: { query: "moana", expect: "Moana" }, minChapters: 5 }], `${import.meta.dir}/fixtures`);
