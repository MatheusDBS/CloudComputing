package br.bookgather.bookservice.service;

import br.bookgather.bookservice.domain.Book;
import br.bookgather.bookservice.repository.BookRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class BookService {

    private final BookRepository bookRepository;

    public BookService(BookRepository bookRepository) {
        this.bookRepository = bookRepository;
    }

    public List<Book> listar() {
        return bookRepository.findAll();
    }

    public Optional<Book> buscar(Long id) {
        return bookRepository.findById(id);
    }

    public Book salvar(Book book) {
        book.setId(null);
        return bookRepository.save(book);
    }

    public Optional<Book> atualizar(Long id, Book dados) {
        return bookRepository.findById(id).map(atual -> {
            atual.setTitulo(dados.getTitulo());
            atual.setAutor(dados.getAutor());
            atual.setIsbn(dados.getIsbn());
            atual.setAnoPublicacao(dados.getAnoPublicacao());
            return bookRepository.save(atual);
        });
    }

    public boolean deletar(Long id) {
        if (!bookRepository.existsById(id)) {
            return false;
        }
        bookRepository.deleteById(id);
        return true;
    }
}
