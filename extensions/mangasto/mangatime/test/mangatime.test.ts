import { contractTests } from "@storm-sources/host/testkit";
import mangatime from "../src/index";

contractTests(mangatime, [{ source: "mangatime", manga: "blue-lock", search: { query: "سولو", expect: "سولو ليفلينج" }, minChapters: 100 }], `${import.meta.dir}/fixtures`);
