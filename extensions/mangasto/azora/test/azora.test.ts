import { contractTests } from "@storm-sources/host/testkit";
import azora from "../src/index";

contractTests(azora, [{ source: "azora", manga: "nano-machine-s", search: { query: "nano machine", expect: "Nano machine" }, minChapters: 50 }], `${import.meta.dir}/fixtures`);
