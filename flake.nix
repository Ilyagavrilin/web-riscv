{
  description = "SCR1 browser workbench";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    systemc-source = {
      url = "github:accellera-official/systemc/70b0fc8e4a74acc677b0fc73cea08f940c2115d5";
      flake = false;
    };
    binutils-wasm = {
      url = "github:racerxdl/riscv-online-asm/0bc309eb8da8c2573e8f122067c52b815f13090c";
      flake = false;
    };
    scr1 = {
      url = "github:syntacore/scr1/ebb5e3551a9d93c0ee95f0b767dd878b8927e702";
      flake = false;
    };
  };

  outputs =
    {
      nixpkgs,
      scr1,
      systemc-source,
      binutils-wasm,
      ...
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      packagesFor =
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          systemcWasm = pkgs.callPackage ./nix/systemc.nix { src = systemc-source; };
          peripheral = pkgs.callPackage ./nix/peripheral.nix {
            src = ./.;
            inherit systemcWasm;
          };
          toolchain = pkgs.callPackage ./nix/toolchain.nix {
            src = ./.;
            inherit binutils-wasm;
          };
          models = nixpkgs.lib.mapAttrs (
            profile: _:
            pkgs.callPackage ./nix/model.nix {
              inherit scr1 profile;
              src = ./.;
            }
          ) (builtins.fromJSON (builtins.readFile ./web/profiles.json));
        in
        {
          pulse-counter = peripheral;
          peripherals = peripheral;
          systemc = systemcWasm;
          assembler = toolchain;
          default = pkgs.callPackage ./nix/site.nix {
            inherit
              scr1
              models
              peripheral
              toolchain
              ;
            src = ./.;
          };
        }
        // nixpkgs.lib.mapAttrs' (name: value: nixpkgs.lib.nameValuePair "scr1-${name}" value) models;
    in
    {
      packages = forAllSystems packagesFor;
      checks = forAllSystems (system: {
        site = (packagesFor system).default;
      });
      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt-tree);
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          systemcWasm = pkgs.callPackage ./nix/systemc.nix { src = systemc-source; };
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              cmake
              ninja
              verilator
              emscripten
              nodejs
              python3
              nixfmt
            ];
            SCR1_SOURCE = scr1;
            SCR1_SYSTEMC = systemcWasm;
          };
          browser = pkgs.mkShell {
            packages = [ (pkgs.python3.withPackages (p: [ p.playwright ])) ];
            PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.selectBrowsers {
              withChromium = false;
              withChromiumHeadlessShell = true;
              withFirefox = false;
              withWebkit = false;
              withFfmpeg = false;
            };
          };
        }
      );
    };
}
