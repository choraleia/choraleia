package repomap

import (
	"strings"

	sitter "github.com/smacker/go-tree-sitter"
	"github.com/smacker/go-tree-sitter/bash"
	"github.com/smacker/go-tree-sitter/c"
	"github.com/smacker/go-tree-sitter/cpp"
	"github.com/smacker/go-tree-sitter/csharp"
	"github.com/smacker/go-tree-sitter/css"
	"github.com/smacker/go-tree-sitter/dockerfile"
	"github.com/smacker/go-tree-sitter/elixir"
	"github.com/smacker/go-tree-sitter/elm"
	"github.com/smacker/go-tree-sitter/golang"
	"github.com/smacker/go-tree-sitter/groovy"
	"github.com/smacker/go-tree-sitter/hcl"
	"github.com/smacker/go-tree-sitter/html"
	"github.com/smacker/go-tree-sitter/java"
	"github.com/smacker/go-tree-sitter/javascript"
	"github.com/smacker/go-tree-sitter/kotlin"
	"github.com/smacker/go-tree-sitter/lua"
	markdown "github.com/smacker/go-tree-sitter/markdown/tree-sitter-markdown"
	"github.com/smacker/go-tree-sitter/ocaml"
	"github.com/smacker/go-tree-sitter/php"
	"github.com/smacker/go-tree-sitter/protobuf"
	"github.com/smacker/go-tree-sitter/python"
	"github.com/smacker/go-tree-sitter/ruby"
	"github.com/smacker/go-tree-sitter/rust"
	"github.com/smacker/go-tree-sitter/scala"
	"github.com/smacker/go-tree-sitter/sql"
	"github.com/smacker/go-tree-sitter/svelte"
	"github.com/smacker/go-tree-sitter/swift"
	"github.com/smacker/go-tree-sitter/toml"
	"github.com/smacker/go-tree-sitter/typescript/typescript"
	"github.com/smacker/go-tree-sitter/yaml"
)

// ============================================================================
// Go Extractor
// ============================================================================

type GoExtractor struct{}

func (e *GoExtractor) Extract(node *sitter.Node, content []byte) []Symbol {
	var symbols []Symbol
	for i := 0; i < int(node.NamedChildCount()); i++ {
		child := node.NamedChild(i)
		if child == nil {
			continue
		}
		switch child.Type() {
		case "function_declaration":
			if sym := e.extractFunction(child, content); sym != nil {
				symbols = append(symbols, *sym)
			}
		case "method_declaration":
			if sym := e.extractMethod(child, content); sym != nil {
				symbols = append(symbols, *sym)
			}
		case "type_declaration":
			symbols = append(symbols, e.extractTypes(child, content)...)
		case "const_declaration":
			symbols = append(symbols, e.extractConsts(child, content)...)
		case "var_declaration":
			symbols = append(symbols, e.extractVars(child, content)...)
		}
	}
	return symbols
}

func (e *GoExtractor) extractFunction(node *sitter.Node, content []byte) *Symbol {
	nameNode := node.ChildByFieldName("name")
	if nameNode == nil {
		return nil
	}
	return &Symbol{
		Name:      nameNode.Content(content),
		Kind:      SymbolKindFunction,
		Signature: e.buildSignature(node, content, ""),
		StartLine: int(node.StartPoint().Row) + 1,
		EndLine:   int(node.EndPoint().Row) + 1,
	}
}

func (e *GoExtractor) extractMethod(node *sitter.Node, content []byte) *Symbol {
	nameNode := node.ChildByFieldName("name")
	if nameNode == nil {
		return nil
	}
	receiver := ""
	if receiverNode := node.ChildByFieldName("receiver"); receiverNode != nil {
		for i := 0; i < int(receiverNode.NamedChildCount()); i++ {
			child := receiverNode.NamedChild(i)
			if child != nil && child.Type() == "parameter_declaration" {
				if typeNode := child.ChildByFieldName("type"); typeNode != nil {
					receiver = typeNode.Content(content)
				}
			}
		}
	}
	return &Symbol{
		Name:      nameNode.Content(content),
		Kind:      SymbolKindMethod,
		Signature: e.buildSignature(node, content, receiver),
		StartLine: int(node.StartPoint().Row) + 1,
		EndLine:   int(node.EndPoint().Row) + 1,
	}
}

func (e *GoExtractor) buildSignature(node *sitter.Node, content []byte, receiver string) string {
	var sb strings.Builder
	sb.WriteString("func ")
	if receiver != "" {
		sb.WriteString("(")
		sb.WriteString(receiver)
		sb.WriteString(") ")
	}
	if nameNode := node.ChildByFieldName("name"); nameNode != nil {
		sb.WriteString(nameNode.Content(content))
	}
	if paramsNode := node.ChildByFieldName("parameters"); paramsNode != nil {
		sb.WriteString(paramsNode.Content(content))
	}
	if resultNode := node.ChildByFieldName("result"); resultNode != nil {
		sb.WriteString(" ")
		sb.WriteString(resultNode.Content(content))
	}
	return sb.String()
}

func (e *GoExtractor) extractTypes(node *sitter.Node, content []byte) []Symbol {
	var symbols []Symbol
	for i := 0; i < int(node.NamedChildCount()); i++ {
		child := node.NamedChild(i)
		if child == nil || child.Type() != "type_spec" {
			continue
		}
		nameNode := child.ChildByFieldName("name")
		if nameNode == nil {
			continue
		}
		kind := SymbolKindType
		if typeNode := child.ChildByFieldName("type"); typeNode != nil {
			switch typeNode.Type() {
			case "struct_type":
				kind = SymbolKindStruct
			case "interface_type":
				kind = SymbolKindInterface
			}
		}
		symbols = append(symbols, Symbol{
			Name:      nameNode.Content(content),
			Kind:      kind,
			StartLine: int(child.StartPoint().Row) + 1,
			EndLine:   int(child.EndPoint().Row) + 1,
		})
	}
	return symbols
}

func (e *GoExtractor) extractConsts(node *sitter.Node, content []byte) []Symbol {
	var symbols []Symbol
	for i := 0; i < int(node.NamedChildCount()); i++ {
		child := node.NamedChild(i)
		if child == nil || child.Type() != "const_spec" {
			continue
		}
		if nameNode := child.ChildByFieldName("name"); nameNode != nil {
			symbols = append(symbols, Symbol{
				Name:      nameNode.Content(content),
				Kind:      SymbolKindConstant,
				StartLine: int(child.StartPoint().Row) + 1,
				EndLine:   int(child.EndPoint().Row) + 1,
			})
		}
	}
	return symbols
}

func (e *GoExtractor) extractVars(node *sitter.Node, content []byte) []Symbol {
	var symbols []Symbol
	for i := 0; i < int(node.NamedChildCount()); i++ {
		child := node.NamedChild(i)
		if child == nil || child.Type() != "var_spec" {
			continue
		}
		if nameNode := child.ChildByFieldName("name"); nameNode != nil {
			symbols = append(symbols, Symbol{
				Name:      nameNode.Content(content),
				Kind:      SymbolKindVariable,
				StartLine: int(child.StartPoint().Row) + 1,
				EndLine:   int(child.EndPoint().Row) + 1,
			})
		}
	}
	return symbols
}

// ============================================================================
// TypeScript/JavaScript Extractor
// ============================================================================

type TypeScriptExtractor struct{}

func (e *TypeScriptExtractor) Extract(node *sitter.Node, content []byte) []Symbol {
	var symbols []Symbol
	e.extractFromNode(node, content, &symbols)
	return symbols
}

func (e *TypeScriptExtractor) extractFromNode(node *sitter.Node, content []byte, symbols *[]Symbol) {
	if node == nil {
		return
	}
	switch node.Type() {
	case "function_declaration":
		if sym := e.extractFunction(node, content); sym != nil {
			*symbols = append(*symbols, *sym)
		}
	case "class_declaration":
		if sym := e.extractClass(node, content); sym != nil {
			*symbols = append(*symbols, *sym)
		}
	case "interface_declaration":
		if sym := e.extractInterface(node, content); sym != nil {
			*symbols = append(*symbols, *sym)
		}
	case "type_alias_declaration":
		if sym := e.extractTypeAlias(node, content); sym != nil {
			*symbols = append(*symbols, *sym)
		}
	case "lexical_declaration", "variable_declaration":
		*symbols = append(*symbols, e.extractVariables(node, content)...)
	case "export_statement", "program", "statement_block", "module":
		for i := 0; i < int(node.NamedChildCount()); i++ {
			e.extractFromNode(node.NamedChild(i), content, symbols)
		}
	}
}

func (e *TypeScriptExtractor) extractFunction(node *sitter.Node, content []byte) *Symbol {
	nameNode := node.ChildByFieldName("name")
	if nameNode == nil {
		return nil
	}
	var sb strings.Builder
	sb.WriteString("function ")
	sb.WriteString(nameNode.Content(content))
	if paramsNode := node.ChildByFieldName("parameters"); paramsNode != nil {
		sb.WriteString(paramsNode.Content(content))
	}
	if returnTypeNode := node.ChildByFieldName("return_type"); returnTypeNode != nil {
		sb.WriteString(": ")
		sb.WriteString(returnTypeNode.Content(content))
	}
	return &Symbol{
		Name:      nameNode.Content(content),
		Kind:      SymbolKindFunction,
		Signature: sb.String(),
		StartLine: int(node.StartPoint().Row) + 1,
		EndLine:   int(node.EndPoint().Row) + 1,
	}
}

func (e *TypeScriptExtractor) extractClass(node *sitter.Node, content []byte) *Symbol {
	nameNode := node.ChildByFieldName("name")
	if nameNode == nil {
		return nil
	}
	sym := &Symbol{
		Name:      nameNode.Content(content),
		Kind:      SymbolKindClass,
		StartLine: int(node.StartPoint().Row) + 1,
		EndLine:   int(node.EndPoint().Row) + 1,
	}
	if bodyNode := node.ChildByFieldName("body"); bodyNode != nil {
		sym.Children = e.extractClassMembers(bodyNode, content)
	}
	return sym
}

func (e *TypeScriptExtractor) extractClassMembers(node *sitter.Node, content []byte) []Symbol {
	var members []Symbol
	for i := 0; i < int(node.NamedChildCount()); i++ {
		child := node.NamedChild(i)
		if child == nil {
			continue
		}
		switch child.Type() {
		case "method_definition":
			if nameNode := child.ChildByFieldName("name"); nameNode != nil {
				var sb strings.Builder
				sb.WriteString(nameNode.Content(content))
				if paramsNode := child.ChildByFieldName("parameters"); paramsNode != nil {
					sb.WriteString(paramsNode.Content(content))
				}
				if returnTypeNode := child.ChildByFieldName("return_type"); returnTypeNode != nil {
					sb.WriteString(": ")
					sb.WriteString(returnTypeNode.Content(content))
				}
				members = append(members, Symbol{
					Name:      nameNode.Content(content),
					Kind:      SymbolKindMethod,
					Signature: sb.String(),
					StartLine: int(child.StartPoint().Row) + 1,
					EndLine:   int(child.EndPoint().Row) + 1,
				})
			}
		case "public_field_definition", "field_definition":
			if nameNode := child.ChildByFieldName("name"); nameNode != nil {
				members = append(members, Symbol{
					Name:      nameNode.Content(content),
					Kind:      SymbolKindVariable,
					StartLine: int(child.StartPoint().Row) + 1,
					EndLine:   int(child.EndPoint().Row) + 1,
				})
			}
		}
	}
	return members
}

func (e *TypeScriptExtractor) extractInterface(node *sitter.Node, content []byte) *Symbol {
	nameNode := node.ChildByFieldName("name")
	if nameNode == nil {
		return nil
	}
	return &Symbol{
		Name:      nameNode.Content(content),
		Kind:      SymbolKindInterface,
		StartLine: int(node.StartPoint().Row) + 1,
		EndLine:   int(node.EndPoint().Row) + 1,
	}
}

func (e *TypeScriptExtractor) extractTypeAlias(node *sitter.Node, content []byte) *Symbol {
	nameNode := node.ChildByFieldName("name")
	if nameNode == nil {
		return nil
	}
	return &Symbol{
		Name:      nameNode.Content(content),
		Kind:      SymbolKindType,
		StartLine: int(node.StartPoint().Row) + 1,
		EndLine:   int(node.EndPoint().Row) + 1,
	}
}

func (e *TypeScriptExtractor) extractVariables(node *sitter.Node, content []byte) []Symbol {
	var symbols []Symbol
	for i := 0; i < int(node.NamedChildCount()); i++ {
		child := node.NamedChild(i)
		if child == nil || child.Type() != "variable_declarator" {
			continue
		}
		nameNode := child.ChildByFieldName("name")
		if nameNode == nil {
			continue
		}
		kind := SymbolKindVariable
		if valueNode := child.ChildByFieldName("value"); valueNode != nil {
			if valueNode.Type() == "arrow_function" || valueNode.Type() == "function" {
				kind = SymbolKindFunction
			}
		}
		symbols = append(symbols, Symbol{
			Name:      nameNode.Content(content),
			Kind:      kind,
			StartLine: int(child.StartPoint().Row) + 1,
			EndLine:   int(child.EndPoint().Row) + 1,
		})
	}
	return symbols
}

// ============================================================================
// Python Extractor
// ============================================================================

type PythonExtractor struct{}

func (e *PythonExtractor) Extract(node *sitter.Node, content []byte) []Symbol {
	var symbols []Symbol
	e.extractFromNode(node, content, &symbols, 0)
	return symbols
}

func (e *PythonExtractor) extractFromNode(node *sitter.Node, content []byte, symbols *[]Symbol, depth int) {
	if node == nil || depth > 2 {
		return
	}
	switch node.Type() {
	case "function_definition":
		if sym := e.extractFunction(node, content); sym != nil {
			*symbols = append(*symbols, *sym)
		}
	case "class_definition":
		if sym := e.extractClass(node, content); sym != nil {
			*symbols = append(*symbols, *sym)
		}
	case "assignment":
		if depth == 0 {
			if sym := e.extractAssignment(node, content); sym != nil {
				*symbols = append(*symbols, *sym)
			}
		}
	case "module":
		for i := 0; i < int(node.NamedChildCount()); i++ {
			e.extractFromNode(node.NamedChild(i), content, symbols, depth)
		}
	}
}

func (e *PythonExtractor) extractFunction(node *sitter.Node, content []byte) *Symbol {
	nameNode := node.ChildByFieldName("name")
	if nameNode == nil {
		return nil
	}
	sig := "def " + nameNode.Content(content)
	if paramsNode := node.ChildByFieldName("parameters"); paramsNode != nil {
		sig += paramsNode.Content(content)
	}
	if returnTypeNode := node.ChildByFieldName("return_type"); returnTypeNode != nil {
		sig += " -> " + returnTypeNode.Content(content)
	}
	return &Symbol{
		Name:      nameNode.Content(content),
		Kind:      SymbolKindFunction,
		Signature: sig,
		StartLine: int(node.StartPoint().Row) + 1,
		EndLine:   int(node.EndPoint().Row) + 1,
	}
}

func (e *PythonExtractor) extractClass(node *sitter.Node, content []byte) *Symbol {
	nameNode := node.ChildByFieldName("name")
	if nameNode == nil {
		return nil
	}
	sym := &Symbol{
		Name:      nameNode.Content(content),
		Kind:      SymbolKindClass,
		StartLine: int(node.StartPoint().Row) + 1,
		EndLine:   int(node.EndPoint().Row) + 1,
	}
	if bodyNode := node.ChildByFieldName("body"); bodyNode != nil {
		for i := 0; i < int(bodyNode.NamedChildCount()); i++ {
			child := bodyNode.NamedChild(i)
			if child != nil && child.Type() == "function_definition" {
				if nameNode := child.ChildByFieldName("name"); nameNode != nil {
					sig := "def " + nameNode.Content(content)
					if paramsNode := child.ChildByFieldName("parameters"); paramsNode != nil {
						sig += paramsNode.Content(content)
					}
					if returnTypeNode := child.ChildByFieldName("return_type"); returnTypeNode != nil {
						sig += " -> " + returnTypeNode.Content(content)
					}
					sym.Children = append(sym.Children, Symbol{
						Name:      nameNode.Content(content),
						Kind:      SymbolKindMethod,
						Signature: sig,
						StartLine: int(child.StartPoint().Row) + 1,
						EndLine:   int(child.EndPoint().Row) + 1,
					})
				}
			}
		}
	}
	return sym
}

func (e *PythonExtractor) extractAssignment(node *sitter.Node, content []byte) *Symbol {
	leftNode := node.ChildByFieldName("left")
	if leftNode == nil || leftNode.Type() != "identifier" {
		return nil
	}
	name := leftNode.Content(content)
	if len(name) > 0 && name[0] == '_' {
		return nil
	}
	return &Symbol{
		Name:      name,
		Kind:      SymbolKindVariable,
		StartLine: int(node.StartPoint().Row) + 1,
		EndLine:   int(node.EndPoint().Row) + 1,
	}
}

// ============================================================================
// Generic Extractor (for other languages)
// ============================================================================

type GenericExtractor struct {
	lang      string
	nodeTypes map[string]SymbolKind
}

func NewGenericExtractor(lang string) *GenericExtractor {
	return &GenericExtractor{lang: lang, nodeTypes: getNodeTypesForLanguage(lang)}
}

func (e *GenericExtractor) Extract(node *sitter.Node, content []byte) []Symbol {
	var symbols []Symbol
	e.extractFromNode(node, content, &symbols, 0)
	return symbols
}

func (e *GenericExtractor) extractFromNode(node *sitter.Node, content []byte, symbols *[]Symbol, depth int) {
	if node == nil || depth > 10 {
		return
	}
	if kind, ok := e.nodeTypes[node.Type()]; ok {
		if sym := e.extractSymbol(node, content, kind); sym != nil {
			*symbols = append(*symbols, *sym)
		}
	}
	for i := 0; i < int(node.NamedChildCount()); i++ {
		e.extractFromNode(node.NamedChild(i), content, symbols, depth+1)
	}
}

func (e *GenericExtractor) extractSymbol(node *sitter.Node, content []byte, kind SymbolKind) *Symbol {
	nameNode := node.ChildByFieldName("name")
	if nameNode == nil {
		nameNode = node.ChildByFieldName("identifier")
	}
	if nameNode == nil && node.NamedChildCount() > 0 {
		firstChild := node.NamedChild(0)
		if firstChild != nil && (firstChild.Type() == "identifier" || firstChild.Type() == "name") {
			nameNode = firstChild
		}
	}
	if nameNode == nil {
		return nil
	}
	name := nameNode.Content(content)
	if name == "" {
		return nil
	}
	var sig string
	if kind == SymbolKindFunction || kind == SymbolKindMethod {
		sig = e.buildSignature(node, content, name)
	}
	return &Symbol{
		Name:      name,
		Kind:      kind,
		Signature: sig,
		StartLine: int(node.StartPoint().Row) + 1,
		EndLine:   int(node.EndPoint().Row) + 1,
		Children:  e.extractChildren(node, content),
	}
}

func (e *GenericExtractor) buildSignature(node *sitter.Node, content []byte, name string) string {
	var sb strings.Builder
	switch e.lang {
	case "rust":
		sb.WriteString("fn ")
	case "ruby", "elixir":
		sb.WriteString("def ")
	case "lua":
		sb.WriteString("function ")
	case "kotlin", "scala":
		sb.WriteString("fun ")
	default:
		sb.WriteString("func ")
	}
	sb.WriteString(name)
	if p := node.ChildByFieldName("parameters"); p != nil {
		sb.WriteString(p.Content(content))
	} else if p := node.ChildByFieldName("formal_parameters"); p != nil {
		sb.WriteString(p.Content(content))
	}
	if r := node.ChildByFieldName("return_type"); r != nil {
		sb.WriteString(" -> ")
		sb.WriteString(r.Content(content))
	}
	return sb.String()
}

func (e *GenericExtractor) extractChildren(node *sitter.Node, content []byte) []Symbol {
	var children []Symbol
	bodyNode := node.ChildByFieldName("body")
	if bodyNode == nil {
		bodyNode = node.ChildByFieldName("block")
	}
	if bodyNode == nil {
		return children
	}
	for i := 0; i < int(bodyNode.NamedChildCount()); i++ {
		child := bodyNode.NamedChild(i)
		if child == nil {
			continue
		}
		if kind, ok := e.nodeTypes[child.Type()]; ok && (kind == SymbolKindMethod || kind == SymbolKindFunction) {
			if sym := e.extractSymbol(child, content, kind); sym != nil {
				children = append(children, *sym)
			}
		}
	}
	return children
}

func getNodeTypesForLanguage(lang string) map[string]SymbolKind {
	m := map[string]SymbolKind{
		"function_declaration":  SymbolKindFunction,
		"function_definition":   SymbolKindFunction,
		"method_declaration":    SymbolKindMethod,
		"method_definition":     SymbolKindMethod,
		"class_declaration":     SymbolKindClass,
		"class_definition":      SymbolKindClass,
		"interface_declaration": SymbolKindInterface,
		"struct_declaration":    SymbolKindStruct,
		"struct_definition":     SymbolKindStruct,
		"type_declaration":      SymbolKindType,
		"type_definition":       SymbolKindType,
		"const_declaration":     SymbolKindConstant,
		"variable_declaration":  SymbolKindVariable,
	}
	switch lang {
	case "rust":
		m["function_item"] = SymbolKindFunction
		m["impl_item"] = SymbolKindType
		m["trait_item"] = SymbolKindInterface
		m["struct_item"] = SymbolKindStruct
		m["enum_item"] = SymbolKindType
	case "java":
		m["constructor_declaration"] = SymbolKindMethod
		m["field_declaration"] = SymbolKindVariable
		m["enum_declaration"] = SymbolKindType
	case "kotlin":
		m["object_declaration"] = SymbolKindClass
		m["property_declaration"] = SymbolKindVariable
	case "ruby":
		m["method"] = SymbolKindMethod
		m["class"] = SymbolKindClass
		m["module"] = SymbolKindType
	case "swift":
		m["protocol_declaration"] = SymbolKindInterface
		m["enum_declaration"] = SymbolKindType
	case "c", "cpp":
		m["struct_specifier"] = SymbolKindStruct
		m["class_specifier"] = SymbolKindClass
		m["namespace_definition"] = SymbolKindType
	case "csharp":
		m["constructor_declaration"] = SymbolKindMethod
		m["property_declaration"] = SymbolKindVariable
		m["field_declaration"] = SymbolKindVariable
		m["namespace_declaration"] = SymbolKindType
		m["enum_declaration"] = SymbolKindType
	case "php":
		m["trait_declaration"] = SymbolKindType
	case "protobuf":
		m["message"] = SymbolKindType
		m["service"] = SymbolKindType
		m["rpc"] = SymbolKindMethod
	case "hcl":
		m["block"] = SymbolKindType
		m["attribute"] = SymbolKindVariable
	}
	return m
}

// ============================================================================
// Language Registration
// ============================================================================

func (s *RepoMapService) registerLanguages() {
	// Go - custom extractor
	goLang := golang.GetLanguage()
	goParser := sitter.NewParser()
	goParser.SetLanguage(goLang)
	s.parsers["go"] = &LanguageParser{
		parser:    goParser,
		language:  goLang,
		extractor: &GoExtractor{},
	}

	// TypeScript/JavaScript - custom extractor
	tsLang := typescript.GetLanguage()
	tsParser := sitter.NewParser()
	tsParser.SetLanguage(tsLang)
	tsExtractor := &TypeScriptExtractor{}
	s.parsers["typescript"] = &LanguageParser{
		parser:    tsParser,
		language:  tsLang,
		extractor: tsExtractor,
	}
	jsParser := sitter.NewParser()
	jsParser.SetLanguage(tsLang)
	s.parsers["javascript"] = &LanguageParser{
		parser:    jsParser,
		language:  tsLang,
		extractor: tsExtractor,
	}

	// Python - custom extractor
	pyLang := python.GetLanguage()
	pyParser := sitter.NewParser()
	pyParser.SetLanguage(pyLang)
	s.parsers["python"] = &LanguageParser{
		parser:    pyParser,
		language:  pyLang,
		extractor: &PythonExtractor{},
	}

	// Register all other languages with generic extractor
	s.registerLang("rust", rust.GetLanguage())
	s.registerLang("java", java.GetLanguage())
	s.registerLang("kotlin", kotlin.GetLanguage())
	s.registerLang("scala", scala.GetLanguage())
	s.registerLang("ruby", ruby.GetLanguage())
	s.registerLang("elixir", elixir.GetLanguage())
	s.registerLang("lua", lua.GetLanguage())
	s.registerLang("swift", swift.GetLanguage())
	s.registerLang("c", c.GetLanguage())
	s.registerLang("cpp", cpp.GetLanguage())
	s.registerLang("csharp", csharp.GetLanguage())
	s.registerLang("php", php.GetLanguage())
	s.registerLang("sql", sql.GetLanguage())
	s.registerLang("bash", bash.GetLanguage())
	s.registerLang("hcl", hcl.GetLanguage())
	s.registerLang("protobuf", protobuf.GetLanguage())
	s.registerLang("groovy", groovy.GetLanguage())
	s.registerLang("elm", elm.GetLanguage())
	s.registerLang("ocaml", ocaml.GetLanguage())
	s.registerLang("css", css.GetLanguage())
	s.registerLang("html", html.GetLanguage())
	s.registerLang("yaml", yaml.GetLanguage())
	s.registerLang("toml", toml.GetLanguage())
	s.registerLang("markdown", markdown.GetLanguage())
	s.registerLang("dockerfile", dockerfile.GetLanguage())
	s.registerLang("svelte", svelte.GetLanguage())
	s.registerLang("javascript_generic", javascript.GetLanguage())
}

func (s *RepoMapService) registerLang(name string, lang *sitter.Language) {
	parser := sitter.NewParser()
	parser.SetLanguage(lang)
	s.parsers[name] = &LanguageParser{
		parser:    parser,
		language:  lang,
		extractor: NewGenericExtractor(name),
	}
}
