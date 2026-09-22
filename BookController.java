package br.bookgather.bookservice.controller;

import br.bookgather.bookservice.domain.Book;
import br.bookgather.bookservice.service.BookService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/books")
public class BookController {

    private final BookService bookService;

    public BookController(BookService bookService) {
        this.bookService = bookService;
    }

    @GetMapping
    public List<Book> listar() {
        return bookService.listar();
    }

    @GetMapping("/{id}")
    public ResponseEntity<Book> buscar(@PathVariable Long id) {
        return bookService.buscar(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<Book> salvar(@RequestBody Book book) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(bookService.salvar(book));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Book> atualizar(
            @PathVariable Long id,
            @RequestBody Book book) {
        return bookService.atualizar(id, book)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deletar(@PathVariable Long id) {
        if (!bookService.deletar(id)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.noContent().build();
    }
}
